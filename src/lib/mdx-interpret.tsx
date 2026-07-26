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
import matter from 'gray-matter'
import type { ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

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
      return expression.name !== undefined && expression.name !== 'undefined'
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
      return key === undefined ? undefined : (object as Record<string, unknown>)[key]
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
          key?: { type: string; name?: string; value?: unknown }
          value?: unknown
        }
        if (entry.type !== 'Property' || !entry.key) return undefined
        const key =
          entry.key.type === 'Identifier'
            ? entry.key.name
            : entry.key.type === 'Literal'
              ? String(entry.key.value)
              : undefined
        if (key === undefined) return undefined
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
    evaluateExpression: (expression: unknown) => evaluateStaticExpression(expression, components),
    evaluatePattern: () => undefined,
    evaluateProgram: () => undefined,
  })
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
  const { content: body, data } = input.parseFrontmatter
    ? matter(input.source)
    : { content: input.source, data: {} }

  const parsed = processor.parse(body)
  const tree = (await processor.run(parsed)) as Root

  const content = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: input.components as Parameters<typeof toJsxRuntime>[1]['components'],
    createEvaluater: createStaticEvaluater(input.components),
    elementAttributeNameCase: 'react',
  })

  return { content, frontmatter: data as Record<string, unknown> }
}
