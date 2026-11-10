/**
 * Wire format for a normalized operation. `$ref`s are expanded inline, so the same component schema recurs wherever it is
 * used, and a cyclic one is re-expanded per entry point as separate copies. Serialized as is, that tree dominates the page
 * (tens of MB for a large spec). Packing stores each structurally distinct object or array once and refers to it by index;
 * unpacking rebuilds the same tree with shared nodes. Entries only refer to lower indexes, and the last one is the root.
 */

type Json = null | boolean | number | string | Array<Json> | { [key: string]: Json }

/** A reference to an entry; real data never has this shape because every object is replaced by one. */
interface Ref {
  '#': number
}

export interface PackedValue {
  packed: Array<Json>
}

const isRef = (value: unknown): value is Ref =>
  typeof value === 'object' && value !== null && typeof (value as Ref)['#'] === 'number'

export function isPacked(value: unknown): value is PackedValue {
  return typeof value === 'object' && value !== null && Array.isArray((value as PackedValue).packed)
}

export function packValue<T>(root: T): PackedValue {
  const entries: Array<Json> = []
  const byContent = new Map<string, number>()
  // Normalization shares subtrees by identity, so a node seen again costs nothing.
  const byIdentity = new Map<object, number>()

  const intern = (value: object): number => {
    const known = byIdentity.get(value)
    if (known !== undefined) return known
    // Post-order and iterative per level would be possible; schemas expand to a few dozen levels, so recursion is fine.
    let entry: Json
    if (Array.isArray(value)) {
      entry = value.map(child)
    } else {
      const out: { [key: string]: Json } = {}
      // defineProperty, not assignment: assigning `__proto__` would set the prototype and lose the key.
      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) Object.defineProperty(out, key, { value: child(item), enumerable: true, writable: true, configurable: true })
      }
      entry = out
    }
    const content = JSON.stringify(entry)
    let index = byContent.get(content)
    if (index === undefined) {
      index = entries.push(entry) - 1
      byContent.set(content, index)
    }
    byIdentity.set(value, index)
    return index
  }
  const child = (item: unknown): Json => (typeof item === 'object' && item !== null ? ({ '#': intern(item) } satisfies Ref) : (item as Json) ?? null)

  entries.push({ '#': intern(root as object) } satisfies Ref)
  return { packed: entries }
}

export function unpackValue<T>({ packed }: PackedValue): T {
  const built: Array<unknown> = []
  const resolve = (item: Json): unknown => (isRef(item) ? built[item['#']] : item)
  for (const entry of packed.slice(0, -1)) {
    built.push(
      Array.isArray(entry)
        ? entry.map(resolve)
        : Object.fromEntries(Object.entries(entry as { [key: string]: Json }).map(([key, item]) => [key, resolve(item)])),
    )
  }
  return resolve(packed[packed.length - 1]) as T
}
