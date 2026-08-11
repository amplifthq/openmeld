const JSON_STRING_DELIMITER = '"';
const JSON_ESCAPE_CHARACTER = "\\";
const JSONC_COMMENT_PREFIX = "/";
const JSONC_BLOCK_COMMENT_START = "*";
const JSONC_BLOCK_COMMENT_END = "/";
const WHITESPACE_CHARACTER_PATTERN = /\s/;

type JsoncCommentMode = "block" | "line" | null;
type JsoncStringScannerState = {
  escaped: boolean;
  inString: boolean;
};

const isLineBreakCharacter = (character: string): boolean => {
  return character === "\n" || character === "\r";
};

const advanceJsonStringState = (
  state: JsoncStringScannerState,
  currentCharacter: string
): JsoncStringScannerState => {
  if (state.inString) {
    if (state.escaped) {
      return { ...state, escaped: false };
    }

    if (currentCharacter === JSON_ESCAPE_CHARACTER) {
      return { ...state, escaped: true };
    }

    if (currentCharacter === JSON_STRING_DELIMITER) {
      return { escaped: false, inString: false };
    }

    return state;
  }

  if (currentCharacter === JSON_STRING_DELIMITER) {
    return { escaped: false, inString: true };
  }

  return state;
};

const resolveJsoncCommentMode = (
  currentCharacter: string,
  nextCharacter: string,
  inString: boolean
): JsoncCommentMode => {
  if (inString || currentCharacter !== JSONC_COMMENT_PREFIX) {
    return null;
  }

  if (nextCharacter === JSONC_COMMENT_PREFIX) {
    return "line";
  }

  return nextCharacter === JSONC_BLOCK_COMMENT_START ? "block" : null;
};

const handleJsoncCommentCharacter = (input: {
  currentCharacter: string;
  currentMode: JsoncCommentMode;
  nextCharacter: string;
  pushCharacter: (character: string) => void;
}): {
  consumedNextCharacter: boolean;
  nextMode: JsoncCommentMode;
} => {
  if (input.currentMode === "line") {
    if (isLineBreakCharacter(input.currentCharacter)) {
      input.pushCharacter(input.currentCharacter);
      return {
        consumedNextCharacter: false,
        nextMode: null,
      };
    }

    return {
      consumedNextCharacter: false,
      nextMode: "line",
    };
  }

  if (
    input.currentCharacter === JSONC_BLOCK_COMMENT_START &&
    input.nextCharacter === JSONC_BLOCK_COMMENT_END
  ) {
    return {
      consumedNextCharacter: true,
      nextMode: null,
    };
  }

  if (isLineBreakCharacter(input.currentCharacter)) {
    input.pushCharacter(input.currentCharacter);
  }

  return {
    consumedNextCharacter: false,
    nextMode: "block",
  };
};

const stripJsoncComments = (source: string): string => {
  let result = "";
  let commentMode: JsoncCommentMode = null;
  let stringState: JsoncStringScannerState = {
    escaped: false,
    inString: false,
  };

  for (let index = 0; index < source.length; index += 1) {
    const currentCharacter = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (commentMode) {
      const commentCharacterOutcome = handleJsoncCommentCharacter({
        currentCharacter,
        currentMode: commentMode,
        nextCharacter,
        pushCharacter: (character) => {
          result += character;
        },
      });
      commentMode = commentCharacterOutcome.nextMode;
      if (commentCharacterOutcome.consumedNextCharacter) {
        index += 1;
      }
      continue;
    }

    const nextCommentMode = resolveJsoncCommentMode(
      currentCharacter,
      nextCharacter,
      stringState.inString
    );
    if (nextCommentMode) {
      commentMode = nextCommentMode;
      index += 1;
      continue;
    }

    result += currentCharacter;
    stringState = advanceJsonStringState(stringState, currentCharacter);
  }

  return result;
};

const resolveNextNonWhitespaceCharacter = (
  source: string,
  startIndex: number
): string | null => {
  for (
    let lookaheadIndex = startIndex;
    lookaheadIndex < source.length;
    lookaheadIndex += 1
  ) {
    const lookaheadCharacter = source[lookaheadIndex] ?? "";
    if (!WHITESPACE_CHARACTER_PATTERN.test(lookaheadCharacter)) {
      return lookaheadCharacter;
    }
  }

  return null;
};

const stripJsoncTrailingCommas = (source: string): string => {
  let result = "";
  let stringState: JsoncStringScannerState = {
    escaped: false,
    inString: false,
  };

  for (let index = 0; index < source.length; index += 1) {
    const currentCharacter = source[index] ?? "";
    const nextNonWhitespaceCharacter = resolveNextNonWhitespaceCharacter(
      source,
      index + 1
    );

    if (
      !stringState.inString &&
      currentCharacter === "," &&
      (nextNonWhitespaceCharacter === "}" || nextNonWhitespaceCharacter === "]")
    ) {
      continue;
    }

    result += currentCharacter;
    stringState = advanceJsonStringState(stringState, currentCharacter);
  }

  return result;
};

export const parseJsoncObject = <T>(source: string): T => {
  return JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(source))) as T;
};
