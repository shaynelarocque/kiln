/**
 * Play's reading of a variable's C expression source. Custom sources are C that runs on the board,
 * so Play can only run the part of C they're usually written in: integer and floating maths,
 * comparisons, logic, bit operations, the ternary, casts, `lv_subject_get_int(ui_var_…)` on other
 * variables, and a few helpers (lv_map, LV_MIN/LV_MAX/LV_CLAMP/LV_ABS, abs, millis, lv_tick_get,
 * Arduino's random). Values follow C's rules: int32 wraps, integer division truncates, and a
 * double anywhere in an operation makes it a double one. Anything else, like your own functions,
 * comes back as an error naming it, and Play leaves that variable alone.
 */

/** What an expression can see: other variables' values, Play's clock in ms, and a random source. */
export type ExprEnv = { get: (variableId: string) => number; now: number; random: () => number }

export type ParsedExpr =
  { ok: true; run: (env: ExprEnv) => number; uses: string[] } | { ok: false; error: string }

/** A C value: its number, and whether it's floating point (double) rather than an integer. */
type Val = { v: number; f: boolean }
type Node = (env: ExprEnv) => Val

const int = (v: number): Val => ({ v: v | 0, f: false })
const dbl = (v: number): Val => ({ v, f: true })

const PUNCT = ["<<", ">>", "<=", ">=", "==", "!=", "&&", "||", ..."?:(),+-*/%<>!~&|^"]

const TYPES = new Set([
  "int",
  "long",
  "short",
  "char",
  "signed",
  "unsigned",
  "bool",
  "float",
  "double",
  "size_t",
  "int8_t",
  "uint8_t",
  "int16_t",
  "uint16_t",
  "int32_t",
  "uint32_t",
  "int64_t",
  "uint64_t",
])

type Token = { t: "num"; v: Val } | { t: "id"; v: string } | { t: "op"; v: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const space = /^\s+/.exec(rest)
    if (space) {
      i += space[0].length
      continue
    }
    const float = /^(\d+\.\d*|\.\d+)([eE][+-]?\d+)?[fFlL]?|^\d+[eE][+-]?\d+[fFlL]?/.exec(rest)
    if (float) {
      tokens.push({ t: "num", v: dbl(parseFloat(float[0])) })
      i += float[0].length
      continue
    }
    const number = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)[uUlL]*/.exec(rest)
    if (number) {
      const n = number[1]
      // C reads a leading 0 as octal
      const value = /^0[0-7]+$/.test(n)
        ? parseInt(n, 8)
        : /^0[bB]/.test(n)
          ? parseInt(n.slice(2), 2)
          : Number(n)
      tokens.push({ t: "num", v: int(value) })
      i += number[0].length
      continue
    }
    const id = /^[A-Za-z_]\w*/.exec(rest)
    if (id) {
      tokens.push({ t: "id", v: id[0] })
      i += id[0].length
      continue
    }
    const op = PUNCT.find(p => rest.startsWith(p))
    if (!op) throw new Error(`“${rest[0]}” isn't something Play can read`)
    tokens.push({ t: "op", v: op })
    i += op.length
  }
  return tokens
}

/** Applies a cast to a C type, given as its words ("unsigned int", "uint8_t"). */
function cast(type: string, x: Val): Val {
  if (/float|double/.test(type)) return dbl(x.v)
  const v = Math.trunc(x.v)
  if (type === "bool") return int(v !== 0 ? 1 : 0)
  if (type === "uint8_t" || type === "unsigned char") return int(v & 0xff)
  if (type === "int8_t" || type === "char" || type === "signed char") return int((v << 24) >> 24)
  if (type === "uint16_t" || type === "unsigned short") return int(v & 0xffff)
  if (type === "int16_t" || type === "short") return int((v << 16) >> 16)
  return int(v)
}

const truthy = (x: Val) => x.v !== 0

/** C's arithmetic: integers wrap at 32 bits and divide toward zero, unless a double is involved. */
function arith(op: string, a: Val, b: Val): Val {
  if (a.f || b.f) {
    if (op === "+") return dbl(a.v + b.v)
    if (op === "-") return dbl(a.v - b.v)
    if (op === "*") return dbl(a.v * b.v)
    if (op === "/") return dbl(a.v / b.v)
    throw new Error(`“${op}” needs whole numbers`)
  }
  if (op === "+") return int(a.v + b.v)
  if (op === "-") return int(a.v - b.v)
  if (op === "*") return int(Math.imul(a.v, b.v))
  // dividing by zero is undefined in C; Play reads it as 0 rather than stopping
  if (op === "/") return int(b.v === 0 ? 0 : Math.trunc(a.v / b.v))
  if (op === "%") return int(b.v === 0 ? 0 : a.v % b.v)
  if (op === "<<") return int(a.v << (b.v & 31))
  if (op === ">>") return int(a.v >> (b.v & 31))
  if (op === "&") return int(a.v & b.v)
  if (op === "|") return int(a.v | b.v)
  if (op === "^") return int(a.v ^ b.v)
  throw new Error(`“${op}” isn't an operator Play knows`)
}

function compare(op: string, a: Val, b: Val): Val {
  const r =
    op === "<"
      ? a.v < b.v
      : op === "<="
        ? a.v <= b.v
        : op === ">"
          ? a.v > b.v
          : op === ">="
            ? a.v >= b.v
            : op === "=="
              ? a.v === b.v
              : a.v !== b.v
  return int(r ? 1 : 0)
}

/** LVGL's lv_map: clamps to the output range at the ends, integer maths in between. */
function lvMap(x: number, minIn: number, maxIn: number, minOut: number, maxOut: number) {
  if (maxIn >= minIn && x >= maxIn) return maxOut
  if (maxIn >= minIn && x <= minIn) return minOut
  if (maxIn <= minIn && x <= maxIn) return maxOut
  if (maxIn <= minIn && x >= minIn) return minOut
  return Math.trunc(Math.imul(x - minIn, maxOut - minOut) / (maxIn - minIn)) + minOut
}

/** Binary operators by C precedence, loosest first (the ternary sits above them all). */
const LEVELS = [
  ["||"],
  ["&&"],
  ["|"],
  ["^"],
  ["&"],
  ["==", "!="],
  ["<", "<=", ">", ">="],
  ["<<", ">>"],
  ["+", "-"],
  ["*", "/", "%"],
]

/**
 * Parses a custom source's expression. `variables` maps C names (ui_var_…) to the ids of the
 * int variables an expression may read.
 */
export function parseExpr(src: string, variables: Record<string, string>): ParsedExpr {
  try {
    const tokens = tokenize(src)
    if (!tokens.length) throw new Error("it's empty")
    let at = 0
    const uses = new Set<string>()
    const peek = () => tokens[at]
    const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v
    const expect = (v: string) => {
      if (!isOp(v)) throw new Error(`expected “${v}”`)
      at++
    }

    const call = (name: string, args: Node[]): Node => {
      const arity = (n: number) => {
        if (args.length !== n) throw new Error(`${name}() takes ${n} argument${n === 1 ? "" : "s"}`)
      }
      switch (name) {
        case "lv_map":
          arity(5)
          return env => {
            const [x, a, b, c, d] = args.map(f => Math.trunc(f(env).v))
            return int(lvMap(x, a, b, c, d))
          }
        case "LV_MIN":
        case "LV_MAX":
          arity(2)
          return env => {
            const [a, b] = args.map(f => f(env))
            return (name === "LV_MIN" ? a.v < b.v : a.v > b.v) ? a : b
          }
        case "LV_CLAMP":
          arity(3)
          return env => {
            const [lo, v, hi] = args.map(f => f(env))
            const capped = v.v < hi.v ? v : hi
            return lo.v > capped.v ? lo : capped
          }
        case "LV_ABS":
        case "abs":
          arity(1)
          return env => {
            const x = args[0](env)
            return x.f ? dbl(Math.abs(x.v)) : int(Math.abs(x.v))
          }
        case "millis":
        case "lv_tick_get":
          arity(0)
          return env => int(env.now)
        case "random": {
          // Arduino's random(max) and random(min, max): min included, max not
          if (args.length !== 1 && args.length !== 2)
            throw new Error("random() takes 1 or 2 arguments")
          return env => {
            const [lo, hi] = args.length === 2 ? args.map(f => f(env).v) : [0, args[0](env).v]
            return int(hi <= lo ? lo : lo + Math.floor(env.random() * (hi - lo)))
          }
        }
        default:
          throw new Error(`${name}() is code on the board, which Play can't run`)
      }
    }

    const primary = (): Node => {
      const tok = peek()
      if (!tok) throw new Error("it ends too soon")
      at++
      if (tok.t === "num") {
        const value = tok.v
        return () => value
      }
      if (tok.t === "op") {
        if (tok.v !== "(") throw new Error(`“${tok.v}” is out of place`)
        const inner = ternary()
        expect(")")
        return inner
      }
      const name = tok.v
      if (name === "true" || name === "false") {
        const value = int(name === "true" ? 1 : 0)
        return () => value
      }
      if (!isOp("(")) {
        if (name.startsWith("ui_var_"))
          throw new Error(`read ${name} with lv_subject_get_int(${name})`)
        throw new Error(`${name} isn't something Play knows`)
      }
      at++
      if (name === "lv_subject_get_int") {
        const arg = peek()
        if (arg?.t !== "id")
          throw new Error("lv_subject_get_int() takes a variable, like ui_var_level")
        const id = variables[arg.v]
        if (!id) throw new Error(`${arg.v} isn't one of this project's number variables`)
        at++
        expect(")")
        uses.add(id)
        return env => int(env.get(id))
      }
      const args: Node[] = []
      if (!isOp(")"))
        for (;;) {
          args.push(ternary())
          if (!isOp(",")) break
          at++
        }
      expect(")")
      return call(name, args)
    }

    const unary = (): Node => {
      const tok = peek()
      if (tok?.t === "op" && ["-", "+", "!", "~"].includes(tok.v)) {
        at++
        const x = unary()
        if (tok.v === "-") return env => arith("-", int(0), x(env))
        if (tok.v === "+") return x
        if (tok.v === "!") return env => int(truthy(x(env)) ? 0 : 1)
        return env => {
          const v = x(env)
          if (v.f) throw new Error("“~” needs whole numbers")
          return int(~v.v)
        }
      }
      // a cast: "(" type words ")"
      if (isOp("(")) {
        let end = at + 1
        while (tokens[end]?.t === "id" && TYPES.has(tokens[end].v as string)) end++
        if (end > at + 1 && tokens[end]?.t === "op" && tokens[end].v === ")") {
          const type = tokens
            .slice(at + 1, end)
            .map(t => t.v)
            .join(" ")
          at = end + 1
          const x = unary()
          return env => cast(type, x(env))
        }
      }
      return primary()
    }

    const binary = (level: number): Node => {
      if (level === LEVELS.length) return unary()
      let left = binary(level + 1)
      for (;;) {
        const tok = peek()
        if (tok?.t !== "op" || !LEVELS[level].includes(tok.v)) return left
        at++
        const op = tok.v
        const l = left
        const r = binary(level + 1)
        left =
          op === "&&"
            ? env => int(truthy(l(env)) && truthy(r(env)) ? 1 : 0)
            : op === "||"
              ? env => int(truthy(l(env)) || truthy(r(env)) ? 1 : 0)
              : ["<", "<=", ">", ">=", "==", "!="].includes(op)
                ? env => compare(op, l(env), r(env))
                : env => arith(op, l(env), r(env))
      }
    }

    function ternary(): Node {
      const cond = binary(0)
      if (!isOp("?")) return cond
      at++
      const yes = ternary()
      expect(":")
      const no = ternary()
      return env => (truthy(cond(env)) ? yes(env) : no(env))
    }

    const root = ternary()
    if (at < tokens.length) throw new Error(`“${tokens[at].v}” is out of place`)
    return {
      ok: true,
      uses: [...uses],
      // the board stores it as (int32_t)(expr)
      run: env => Math.trunc(root(env).v) | 0,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
