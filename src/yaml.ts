/**
 * Library access that works whether `yaml` resolved as ESM or as CommonJS.
 *
 * This plugin's bundle can be loaded either way — a host that `import()`s the
 * ESM artifact and one that `require()`s a CommonJS build both exist — and Node
 * refuses *named* imports from a CommonJS module (`SyntaxError: does not provide
 * an export named ...`) while a bundled interop helper hands back the namespace
 * object instead. So the packages are imported as namespaces and read through
 * their `default` when present. The implementation stays the same object either
 * way; only the property path differs.
 *
 * `js-yaml` needs no such treatment: it is used as a value (`yaml.dump`), never
 * for its named exports.
 */

import * as yamlNamespace from 'yaml'
import type { Document as YamlDocument, Node as YamlNode, Scalar as YamlScalar, YAMLMap, YAMLSeq } from 'yaml'

/** The namespace a bundled `import * as` yields, or the module itself. */
type Interop<T> = T & { default?: T }

/** Resolve a namespace-or-module import to the real module object. */
function resolve<T extends object>(namespace: Interop<T>): T {
  return namespace.default ?? namespace
}

const yaml = resolve<typeof yamlNamespace>(yamlNamespace as Interop<typeof yamlNamespace>)

/** The `yaml` document API this plugin uses. */
export const parseDocument = yaml.parseDocument
/** Whether a node is a mapping. */
export const isMap = yaml.isMap
/** Whether a node is a sequence. */
export const isSeq = yaml.isSeq
/** Whether a node is a scalar. */
export const isScalar = yaml.isScalar
/** Whether a node is a key/value pair. */
export const isPair = yaml.isPair
/** The scalar node class, used to stamp a `!!js` tag onto an expression. */
export const Scalar = yaml.Scalar

/** The YAML tag marking a `!!js` expression scalar. */
export const JS_TAG = 'tag:yaml.org,2002:js'

/**
 * Walk a node into plain data, recording every `!!js` leaf it holds.
 *
 * `toJSON()` cannot be used for this: `yaml` resolves a tagged scalar to its
 * string value, which would make an expression indistinguishable from a literal
 * that happens to contain code. Walking the node tree keeps the tag visible, so
 * an expression becomes a path plus its source and is never silently evaluated
 * as data.
 *
 * @param node - the node to read.
 * @param path - config-relative path of this node.
 * @param raw - collector for the expression leaves found.
 * @returns the node as plain JSON-safe data, with expression leaves omitted.
 */
export function readYamlNode(node: unknown, path: string[], raw: Array<[string[], string]>): unknown {
  if (isScalar(node)) {
    if (node.tag === JS_TAG) {
      raw.push([[...path], String(node.value ?? '')])
      return undefined
    }
    return node.value
  }
  if (isSeq(node)) {
    return node.items
      .map((item, index) => readYamlNode(item, [...path, String(index)], raw))
      .filter(item => item !== undefined)
  }
  if (isMap(node)) {
    const out: Record<string, unknown> = {}
    for (const item of node.items) {
      if (!isPair(item)) continue
      const key = String(isScalar(item.key) ? item.key.value : '')
      const value = readYamlNode(item.value, [...path, key], raw)
      // A dropped expression leaf is absent rather than null, so a form shows an
      // empty control instead of the literal text "undefined".
      if (value !== undefined) out[key] = value
    }
    return out
  }
  return undefined
}

export type { YamlDocument, YamlNode, YamlScalar, YAMLMap, YAMLSeq }
