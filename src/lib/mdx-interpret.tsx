/**
 * Eval-free MDX rendering for the assets content source.
 *
 * Cloudflare Workers forbid code generation from strings (`eval`,
 * `new Function`), so `compileMDX` — which compiles MDX to JavaScript and
 * executes it — cannot run there. This module renders MDX without any code
 * generation: it parses with remark-mdx, runs the exact same remark/rehype
 * pipeline the build uses (including Shiki highlighting), and converts the
 * resulting hast tree straight to React elements with
 * `hast-util-to-jsx-runtime`, resolving `<Component>` tags through the same
 * MDX components map the compiled path uses.
 *
 * The one MDX feature codegen provided that a tree walk cannot is arbitrary
 * JavaScript expressions (`{props.foo}`, `export const x = …`). Those are
 * evaluated statically: literal expressions (strings, numbers, booleans,
 * arrays, objects, negated numbers, expression-free template strings) produce
 * their value; anything else renders as nothing rather than failing the page.
 * Documentation content overwhelmingly uses JSX with literal attributes, so
 * in practice this renders identically to the compiled output.
 */
import type { Root } from 'hast'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

import { parseFrontmatter } from '@/lib/frontmatter'
import { rehypePlugins } from '@/mdx/rehype'
import { remarkPlugins } from '@/mdx/remark'

/**
 * MDX node types that must survive remark → rehype so the JSX runtime
 * conversion can resolve them against the components map. This is the node
 * set `@mdx-js/mdx` itself passes through.
 */
const MDX_NODE_TYPES = [
  'mdxjsEsm',
  'mdxFlowExpression',
  'mdxJsxFlowElement',
  'mdxJsxTextElement',
  'mdxTextExpression',
] as const

interface InterpretMdxInput {
  source: string
  /**
   * The same MDX components map `compileMDX` receives. Typed loosely because
   * `MDXComponents` allows nested maps and intrinsic-element overrides that
   * `hast-util-to-jsx-runtime` types more narrowly; the runtime contract is
   * identical for the flat component names documentation content uses.
   */
  components: Record<string, unknown>
  /** Parse and strip YAML frontmatter before rendering (doc pages do; snippets don't). */
  parseFrontmatter?: boolean
}

interface InterpretMdxResult {
  content: ReactNode
  frontmatter: Record<string, unknown>
}

/**
 * Statically evaluate an estree expression produced by remark-mdx.
 * Only literal shapes are supported — there is deliberately no code
 * execution. Unsupported expressions yield `undefined`, which drops the
 * attribute or renders nothing for a braced expression.
 */
function evaluateStaticExpression(node: unknown, scope: Record<string, unknown>): unknown {
  if (!node || typeof node !== 'object') return undefined
  const expression = node as {
    type: string
    value?: unknown
    name?: string
    operator?: string
    argument?: unknown
    object?: unknown
    property?: { type: string; name?: string; value?: unknown }
    computed?: boolean
    elements?: Array<unknown>
    properties?: Array<unknown>
    quasis?: Array<{ value?: { cooked?: string } }>
    expressions?: Array<unknown>
  }

  switch (expression.type) {
    case 'Literal':
      return expression.value
    // `hast-util-to-jsx-runtime` resolves capitalized MDX JSX names
    // (`<Note>`, `<Steps.Item>`) through the evaluater as Identifier /
    // MemberExpression estrees — never through its `components` option, which
    // only covers literal lowercase tag names. The components map is
    // therefore the identifier scope here.
    case 'Identifier':
      return expression.name !== undefined && Object.hasOwn(scope, expression.name)
        ? scope[expression.name]
        : undefined
    case 'MemberExpression': {
      const object = evaluateStaticExpression(expression.object, scope)
      // Components are functions carrying sub-components as properties
      // (`<Group.Item>`), so functions are valid member-access targets too.
      if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined
      const property = expression.property
      const key = expression.computed
        ? property?.type === 'Literal'
          ? String(property.value)
          : undefined
        : property?.type === 'Identifier'
          ? property.name
          : undefined
      // Own properties only. An inherited lookup would hand content authors
      // `Function` via `<Anything.constructor>`, which React then calls with
      // an attacker-influenced string — the exact code-generation primitive
      // this module exists to avoid.
      if (key === undefined || !Object.hasOwn(object, key)) return undefined
      return (object as Record<string, unknown>)[key]
    }
    case 'UnaryExpression': {
      const argument = evaluateStaticExpression(expression.argument, scope)
      if (expression.operator === '-' && typeof argument === 'number') return -argument
      if (expression.operator === '+' && typeof argument === 'number') return argument
      if (expression.operator === '!') return !argument
      return undefined
    }
    case 'TemplateLiteral':
      if ((expression.expressions?.length ?? 0) > 0) return undefined
      return (expression.quasis ?? []).map((quasi) => quasi.value?.cooked ?? '').join('')
    case 'ArrayExpression':
      return (expression.elements ?? []).map((element) => evaluateStaticExpression(element, scope))
    case 'ObjectExpression': {
      const result: Record<string, unknown> = {}
      for (const property of expression.properties ?? []) {
        const entry = property as {
          type: string
          computed?: boolean
          key?: { type: string; name?: string; value?: unknown }
          value?: unknown
        }
        if (entry.type !== 'Property' || !entry.key) return undefined
        // A computed key (`{[name]: 1}`) depends on a runtime binding. Reading
        // the identifier's text as the literal key would fabricate a prop the
        // author never wrote, so the whole object degrades instead.
        if (entry.computed && entry.key.type !== 'Literal') return undefined
        const key =
          entry.key.type === 'Identifier'
            ? entry.key.name
            : entry.key.type === 'Literal'
              ? String(entry.key.value)
              : undefined
        if (key === undefined || key === '__proto__') return undefined
        result[key] = evaluateStaticExpression(entry.value, scope)
      }
      return result
    }
    default:
      return undefined
  }
}

/**
 * The evaluater `hast-util-to-jsx-runtime` consults for component names, MDX
 * expression nodes, and expression-valued JSX attributes. Identifiers resolve
 * against the components map; static literals evaluate; programs (leftover
 * `export` statements — imports are stripped before parsing) and everything
 * dynamic evaluate to nothing instead of throwing.
 */
function createStaticEvaluater(components: Record<string, unknown>) {
  return () => ({
    evaluateExpression: (expression: unknown) => {
      const value = evaluateStaticExpression(expression, components)
      // React throws on a plain object in child position ("Objects are not
      // valid as a React child"), which would take the whole route down over
      // one authored `{{ a: 1 }}`. Component objects (memo/forwardRef carry
      // `$$typeof`) are legitimate element types and must pass through; other
      // objects render as nothing, matching this module's failure contract.
      if (value !== null && typeof value === 'object' && !('$$typeof' in value)) return undefined
      return value
    },
    evaluatePattern: () => undefined,
    evaluateProgram: () => undefined,
  })
}

/**
 * Remove MDX expressions that carry no expression — `{/* a comment *\/}`
 * parses to an estree Program with an empty body, and
 * `hast-util-to-jsx-runtime` reads `program.body[0].type` unguarded, throwing
 * before the evaluater is ever consulted. Comments are ordinary in authored
 * content, so they must render as nothing rather than 500 the page.
 */
function dropEmptyExpressions(tree: Root): void {
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent) return
    if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return
    const program = (node.data as { estree?: { body?: Array<unknown> } } | undefined)?.estree
    if (program && (program.body?.length ?? 0) > 0) return
    parent.children.splice(index, 1)
    return [SKIP, index]
  })
}

/**
 * Wrap the JSX runtime so authored mistakes degrade instead of 500ing the
 * route. Under the assets source there is no build-time MDX validation
 * between an author's push and a live render, so an unknown component
 * (`<Nope>`) or an HTML-style string `style` attribute — both fatal to React —
 * must not be able to take a page down. Unknown types render their children;
 * string styles are dropped.
 */
function createLenientJsx<T extends typeof jsx>(create: T): T {
  return ((type: unknown, props: Record<string, unknown>, key?: string) => {
    const isRenderable =
      typeof type === 'string' ||
      typeof type === 'function' ||
      (typeof type === 'object' && type !== null && '$$typeof' in type)
    if (props && typeof props.style === 'string') {
      const { style: _dropped, ...rest } = props
      props = rest
    }
    return create(
      (isRenderable ? type : Fragment) as Parameters<T>[0],
      props as Parameters<T>[1],
      key,
    )
  }) as T
}

const processor = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkPlugins)
  .use(remarkRehype, { passThrough: [...MDX_NODE_TYPES] })
  .use(rehypePlugins)

/**
 * Render MDX to React without code generation. Drop-in replacement for the
 * request-time `compileMDX` path on runtimes where eval is unavailable
 * (Cloudflare Workers). The caller passes the same MDX components map the
 * compiled path uses; snippet imports must already have been extracted.
 */
export async function interpretMDX(input: InterpretMdxInput): Promise<InterpretMdxResult> {
  // `parseFrontmatter` is the hardened parser: authored `---js` frontmatter
  // would otherwise reach a gray-matter engine whose parser is `eval`, a
  // code-execution sink inside a module whose whole premise is that there
  // isn't one.
  const { content: body, data } = input.parseFrontmatter
    ? parseFrontmatter(input.source)
    : { content: input.source, data: {} }

  const parsed = processor.parse(body)
  const tree = (await processor.run(parsed)) as Root
  dropEmptyExpressions(tree)

  const content = toJsxRuntime(tree, {
    Fragment,
    jsx: createLenientJsx(jsx),
    jsxs: createLenientJsx(jsxs),
    components: input.components as Parameters<typeof toJsxRuntime>[1]['components'],
    createEvaluater: createStaticEvaluater(input.components),
    elementAttributeNameCase: 'react',
  })

  // gray-matter hands back a cached object for repeated identical sources;
  // copying keeps a downstream mutation from contaminating later renders.
  return { content, frontmatter: { ...(data as Record<string, unknown>) } }
}
