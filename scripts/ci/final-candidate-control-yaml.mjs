const LINE_SPLIT_PATTERN = /\r?\n/u;
const FULL_LINE_COMMENT_PATTERN = /^\s*(?:#.*)?$/u;
const DOCUMENT_START_PATTERN = /^---\s*(?:#.*)?$/u;
const DOCUMENT_END_PATTERN = /^\.\.\.\s*(?:#.*)?$/u;
const BOM_PATTERN = /^\uFEFF/u;
const KEY_SEPARATOR_PATTERN = /:(?:\s|$)/u;
const INLINE_COMPLEX_SEPARATOR_PATTERN = /\s+:(?:\s|$)/u;
const FLOW_COLLECTION_START_PATTERN = /^\s*[[{]/u;
const YAML_TAG_PATTERN = /^(!!\w+|![A-Za-z][\w-]*|!<[^>]+>)\s*(.*)$/u;

export function parseControlYamlMapping(text) {
  const document = parseYamlDocument(text);
  if (document === null || document === undefined) {
    return {};
  }
  if (typeof document !== "object" || Array.isArray(document)) {
    throw new Error("pnpm-workspace.yaml must parse to a YAML mapping.");
  }
  return document;
}

function parseYamlDocument(text) {
  if (typeof text !== "string") {
    throw new Error("YAML document must be a string.");
  }
  const parser = {
    index: 0,
    lines: text.replace(BOM_PATTERN, "").split(LINE_SPLIT_PATTERN),
  };
  skipEmptyAndComments(parser);
  if (DOCUMENT_START_PATTERN.test(currentLine(parser) ?? "")) {
    parser.index += 1;
    skipEmptyAndComments(parser);
  }
  if (parser.index >= parser.lines.length) {
    return {};
  }
  const value = parseBlockNode(parser, 0);
  skipEmptyAndComments(parser);
  if (DOCUMENT_END_PATTERN.test(currentLine(parser) ?? "")) {
    parser.index += 1;
    skipEmptyAndComments(parser);
  }
  if (parser.index < parser.lines.length) {
    throw new Error(
      `Unexpected YAML content at line ${String(parser.index + 1)}.`
    );
  }
  return value;
}

function parseBlockNode(parser, minIndent) {
  skipEmptyAndComments(parser);
  const line = currentLine(parser);
  if (line === undefined) {
    return null;
  }
  const indent = countIndent(line);
  if (indent < minIndent) {
    return null;
  }
  const trimmed = stripInlineComment(line.slice(indent));
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseFlowCollection(parser, trimmed);
  }
  if (trimmed.startsWith("|") || trimmed.startsWith(">")) {
    throw new Error("YAML block scalars are not accepted in control YAML.");
  }
  if (
    trimmed.startsWith("&") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("!")
  ) {
    throw new Error("YAML tags, anchors, and aliases are not accepted.");
  }
  if (trimmed === "-" || trimmed.startsWith("- ")) {
    return parseBlockSequence(parser, indent);
  }
  if (isMappingStart(trimmed)) {
    return parseBlockMapping(parser, indent);
  }
  parser.index += 1;
  return parseComplexScalarKey(trimmed);
}

function parseBlockMapping(parser, indent) {
  const result = {};
  while (true) {
    skipEmptyAndComments(parser);
    const line = currentLine(parser);
    if (line === undefined) {
      return result;
    }
    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      return result;
    }
    if (currentIndent > indent) {
      throw new Error(
        `Unexpected YAML indent at line ${String(parser.index + 1)}.`
      );
    }
    const trimmed = stripInlineComment(line.slice(currentIndent));
    if (trimmed.startsWith("? ") || trimmed === "?") {
      Object.assign(result, parseComplexMappingEntry(parser, indent, trimmed));
      continue;
    }
    if (trimmed.startsWith("-")) {
      throw new Error(
        `YAML sequence entry is not valid inside a mapping at line ${String(parser.index + 1)}.`
      );
    }
    const { key, rest } = splitSimpleMappingEntry(trimmed);
    result[stringifyYamlKey(key)] = readMappingValue(parser, indent, rest);
  }
}

function parseComplexMappingEntry(parser, indent, trimmed) {
  const afterQuestion = trimmed.slice(1).trim();
  let key;
  if (afterQuestion === "") {
    parser.index += 1;
    key = parseBlockNode(parser, indent + 1);
  } else {
    const inlineValue = splitInlineComplexEntry(afterQuestion);
    if (inlineValue) {
      parser.index += 1;
      return {
        [stringifyYamlKey(inlineValue.key)]: parseInlineOrNestedValue(
          parser,
          inlineValue.rest
        ),
      };
    }
    parser.index += 1;
    key = parseComplexScalarKey(afterQuestion);
  }
  skipEmptyAndComments(parser);
  const valueLine = currentLine(parser);
  if (valueLine === undefined) {
    throw new Error("YAML complex key is missing a value.");
  }
  const valueIndent = countIndent(valueLine);
  const valueTrimmed = stripInlineComment(valueLine.slice(valueIndent));
  if (valueIndent !== indent || !valueTrimmed.startsWith(":")) {
    throw new Error(
      `YAML complex key is missing ':' at line ${String(parser.index + 1)}.`
    );
  }
  return {
    [stringifyYamlKey(key)]: readMappingValue(
      parser,
      indent,
      valueTrimmed.slice(1).trim()
    ),
  };
}

function parseBlockSequence(parser, indent) {
  const items = [];
  while (true) {
    skipEmptyAndComments(parser);
    const line = currentLine(parser);
    if (line === undefined) {
      return items;
    }
    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      return items;
    }
    if (currentIndent > indent) {
      throw new Error(
        `Unexpected YAML indent at line ${String(parser.index + 1)}.`
      );
    }
    const trimmed = stripInlineComment(line.slice(currentIndent));
    if (!(trimmed === "-" || trimmed.startsWith("- "))) {
      return items;
    }
    items.push(readMappingValue(parser, indent, trimmed.slice(1).trim()));
  }
}

function readMappingValue(parser, indent, rest) {
  if (rest !== "") {
    return parseInlineOrNestedValue(parser, rest);
  }
  parser.index += 1;
  skipEmptyAndComments(parser);
  const nextLine = currentLine(parser);
  if (nextLine === undefined) {
    return null;
  }
  if (countIndent(nextLine) > indent) {
    return parseBlockNode(parser, indent + 1);
  }
  return null;
}

function parseInlineOrNestedValue(parser, rest) {
  if (rest.startsWith("|") || rest.startsWith(">")) {
    throw new Error("YAML block scalars are not accepted in control YAML.");
  }
  if (rest.startsWith("&") || rest.startsWith("*") || rest.startsWith("!")) {
    throw new Error("YAML tags, anchors, and aliases are not accepted.");
  }
  if (rest.startsWith("[") || rest.startsWith("{")) {
    return parseFlowCollection(parser, rest);
  }
  parser.index += 1;
  return coercePlainScalar(rest);
}

function parseFlowCollection(parser, firstSegment) {
  let buffer = firstSegment;
  while (!isBalancedFlow(buffer)) {
    parser.index += 1;
    const nextLine = currentLine(parser);
    if (nextLine === undefined) {
      throw new Error("Unterminated YAML flow collection.");
    }
    buffer = `${buffer} ${stripInlineComment(nextLine.trim())}`;
  }
  parser.index += 1;
  const scanner = new FlowScanner(buffer);
  const value = scanner.parseNode();
  scanner.skipSpace();
  if (!scanner.eof()) {
    throw new Error("Unexpected trailing content in YAML flow collection.");
  }
  return value;
}

class FlowScanner {
  constructor(text) {
    this.index = 0;
    this.text = text;
  }

  eof() {
    return this.index >= this.text.length;
  }

  peek() {
    return this.text[this.index] ?? "";
  }

  skipSpace() {
    while (this.peek() === " " || this.peek() === "\t") {
      this.index += 1;
    }
  }

  parseNode() {
    this.skipSpace();
    const character = this.peek();
    if (character === "[") {
      return this.parseSequence();
    }
    if (character === "{") {
      return this.parseMapping();
    }
    if (character === "'" || character === '"') {
      return this.parseQuoted();
    }
    if (
      character === "?" ||
      character === "&" ||
      character === "*" ||
      character === "!"
    ) {
      throw new Error("Unsupported YAML token inside a flow collection.");
    }
    return this.parsePlain();
  }

  parseSequence() {
    this.index += 1;
    const items = [];
    this.skipSpace();
    if (this.peek() === "]") {
      this.index += 1;
      return items;
    }
    while (true) {
      items.push(this.parseNode());
      this.skipSpace();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "]") {
        this.index += 1;
        return items;
      }
      throw new Error("Invalid YAML flow sequence.");
    }
  }

  parseMapping() {
    this.index += 1;
    const result = {};
    this.skipSpace();
    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      const key = this.parseNode();
      this.skipSpace();
      if (this.peek() !== ":") {
        throw new Error("Invalid YAML flow mapping.");
      }
      this.index += 1;
      result[stringifyYamlKey(key)] = this.parseNode();
      this.skipSpace();
      if (this.peek() === ",") {
        this.index += 1;
        continue;
      }
      if (this.peek() === "}") {
        this.index += 1;
        return result;
      }
      throw new Error("Invalid YAML flow mapping.");
    }
  }

  parseQuoted() {
    const { end, value } = readQuotedString(this.text, this.index);
    this.index = end;
    return value;
  }

  parsePlain() {
    const start = this.index;
    while (!this.eof()) {
      const character = this.peek();
      if (
        character === "," ||
        character === "]" ||
        character === "}" ||
        character === ":" ||
        character === "#"
      ) {
        break;
      }
      this.index += 1;
    }
    return coercePlainScalar(this.text.slice(start, this.index).trim());
  }
}

function splitSimpleMappingEntry(trimmed) {
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    const quoted = readQuotedString(trimmed, 0);
    const afterKey = trimmed.slice(quoted.end).trim();
    if (!afterKey.startsWith(":")) {
      throw new Error("Quoted YAML key is missing ':'.");
    }
    return { key: quoted.value, rest: afterKey.slice(1).trim() };
  }
  const separator = trimmed.search(KEY_SEPARATOR_PATTERN);
  if (separator === -1) {
    throw new Error(`YAML mapping entry is missing ':': ${trimmed}`);
  }
  return {
    key: coercePlainScalar(trimmed.slice(0, separator).trim()),
    rest: trimmed.slice(separator + 1).trim(),
  };
}

function splitInlineComplexEntry(afterQuestion) {
  const separator = afterQuestion.search(INLINE_COMPLEX_SEPARATOR_PATTERN);
  if (separator === -1) {
    return null;
  }
  const restStart = afterQuestion.indexOf(":", separator);
  return {
    key: parseComplexScalarKey(afterQuestion.slice(0, separator).trim()),
    rest: afterQuestion.slice(restStart + 1).trim(),
  };
}

function parseComplexScalarKey(text) {
  const tagged = splitYamlTag(text);
  if (tagged.tag !== null && tagged.tag !== "!!str") {
    throw new Error(`Unsupported YAML tag on a complex key: ${tagged.tag}`);
  }
  const remainder = tagged.remainder;
  if (remainder.startsWith("'") || remainder.startsWith('"')) {
    const quoted = readQuotedString(remainder, 0);
    const trailing = remainder.slice(quoted.end).trim();
    if (trailing !== "") {
      throw new Error("Quoted YAML complex key has trailing content.");
    }
    return quoted.value;
  }
  if (
    remainder.startsWith("&") ||
    remainder.startsWith("*") ||
    remainder.startsWith("!") ||
    remainder.startsWith("[") ||
    remainder.startsWith("{")
  ) {
    throw new Error(
      "YAML tags, anchors, aliases, and collection keys are not accepted on complex keys."
    );
  }
  return coercePlainScalar(remainder);
}

function splitYamlTag(text) {
  if (!text.startsWith("!")) {
    return { remainder: text, tag: null };
  }
  const match = YAML_TAG_PATTERN.exec(text);
  if (!match) {
    throw new Error("Unrecognized YAML tag on a complex key.");
  }
  return { remainder: match[2], tag: match[1] };
}

function isMappingStart(trimmed) {
  if (trimmed.startsWith("? ") || trimmed === "?") {
    return true;
  }
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    try {
      const quoted = readQuotedString(trimmed, 0);
      return trimmed.slice(quoted.end).trim().startsWith(":");
    } catch {
      return false;
    }
  }
  return KEY_SEPARATOR_PATTERN.test(trimmed);
}

function readQuotedString(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') {
    throw new Error("Quoted YAML string is missing an opening quote.");
  }
  if (quote === "'") {
    return readSingleQuotedString(text, start);
  }
  return readDoubleQuotedString(text, start);
}

function readSingleQuotedString(text, start) {
  let index = start + 1;
  let value = "";
  while (index < text.length) {
    const character = text[index];
    if (character === "'") {
      if (text[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      return { end: index + 1, value };
    }
    value += character;
    index += 1;
  }
  throw new Error("Unterminated single-quoted YAML string.");
}

function readDoubleQuotedString(text, start) {
  let index = start + 1;
  let value = "";
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      return { end: index + 1, value };
    }
    if (character === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined) {
        throw new Error("Unterminated double-quoted YAML escape.");
      }
      value += unescapeDoubleQuoted(escaped);
      index += 2;
      continue;
    }
    value += character;
    index += 1;
  }
  throw new Error("Unterminated double-quoted YAML string.");
}

function unescapeDoubleQuoted(escaped) {
  switch (escaped) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "\\":
    case '"':
    case "/":
      return escaped;
    default:
      throw new Error(`Unsupported YAML escape '\\${escaped}'.`);
  }
}

function coercePlainScalar(value) {
  if (value === "" || value === "~" || value === "null" || value === "Null") {
    return null;
  }
  if (value === "true" || value === "True") {
    return true;
  }
  if (value === "false" || value === "False") {
    return false;
  }
  return value;
}

function stringifyYamlKey(key) {
  if (key === null || key === undefined) {
    throw new Error("YAML mapping key must not be null.");
  }
  if (typeof key === "object") {
    throw new Error("YAML mapping keys must be scalars.");
  }
  return String(key);
}

function isBalancedFlow(text) {
  let depth = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const step = stepQuotedScan(text, index, quote);
    quote = step.quote;
    index = step.index;
    if (!step.unquoted) {
      continue;
    }
    const character = text[index];
    if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
    }
  }
  return depth === 0 && FLOW_COLLECTION_START_PATTERN.test(text);
}

function stripInlineComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const step = stepQuotedScan(text, index, quote);
    quote = step.quote;
    index = step.index;
    if (step.unquoted && isYamlCommentStart(text, index)) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text;
}

function stepQuotedScan(text, index, quote) {
  const character = text[index];
  if (quote === "'") {
    if (character === "'" && text[index + 1] === "'") {
      return { index: index + 1, quote, unquoted: false };
    }
    return { index, quote: character === "'" ? null : quote, unquoted: false };
  }
  if (quote === '"') {
    if (character === "\\") {
      return { index: index + 1, quote, unquoted: false };
    }
    return { index, quote: character === '"' ? null : quote, unquoted: false };
  }
  if (character === "'" || character === '"') {
    return { index, quote: character, unquoted: false };
  }
  return { index, quote: null, unquoted: true };
}

function isYamlCommentStart(text, index) {
  return (
    text[index] === "#" &&
    (index === 0 || text[index - 1] === " " || text[index - 1] === "\t")
  );
}

function countIndent(line) {
  let indent = 0;
  for (const character of line) {
    if (character === " ") {
      indent += 1;
      continue;
    }
    if (character === "\t") {
      throw new Error("YAML tabs are not accepted in control YAML.");
    }
    break;
  }
  return indent;
}

function skipEmptyAndComments(parser) {
  while (
    parser.index < parser.lines.length &&
    FULL_LINE_COMMENT_PATTERN.test(parser.lines[parser.index])
  ) {
    parser.index += 1;
  }
}

function currentLine(parser) {
  return parser.lines[parser.index];
}
