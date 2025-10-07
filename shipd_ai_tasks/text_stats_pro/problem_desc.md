Analytics Module for Chat/Analytics Platform

Context
Imagine you are writing a backend text analytics module for an analytics or chat platform. Your module will receive raw text from users that can be:

Multilingual (e.g., English, Chinese, Arabic)

Rich in emojis

Heavy on punctuation, symbols, or random whitespace

Your module must parse useful statistics out of the text and have it prepared for further processing.

Objective
Develop a class called TextStatsPro with functionality to:

Extract sentences from raw text.

Count words per sentence.

Count special characters (symbols, punctuation, emojis).

Clean the text (lowercase, remove punctuation, etc.).

Deal with edge cases using controlled exceptions.

Behavior Rules
I. Sentence Extraction
Terminators: A sentence ends with ., !, or ?.

Terminator Inclusion: Extracted sentences must include their terminator(s) in the final output string.

Successive Terminators: Two or more successive terminators are treated as a single sentence boundary. (Example: "Wow!!" => one sentence.)

Whitespace: Leading and trailing whitespace is removed from the resulting sentence string.

Blank Sentences: Blank sentences (containing only whitespace, punctuation, symbols, or emojis) are skipped. A sentence is considered valid only if it contains at least one Unicode letter or digit (i.e., it must match [^\s\W_]|\d). (Examples: ".", "!!", "..." => skipped.)

Error Handling:

If no valid sentences are found (after skipping blanks), raise TextStatsError("No valid sentences").

If the text contains no valid sentence terminators (., !, ?), raise TextStatsError("No valid sentences").

Abbreviation Handling : Periods in known abbreviations do not end a sentence unless specific conditions are met:

Title Abbreviations (e.g., 'Mr.', 'Dr.'): Periods following title abbreviations ('Mr.', 'Mrs.', 'Dr.', 'Ms.', 'Jr.', 'Sr.') do not mark a sentence boundary, even if followed by a capitalized proper noun.

General Abbreviations (e.g., 'U.K.', 'i.e.', 'vs.'): A period after a general abbreviation is treated as a sentence terminator if it is followed by whitespace and then a subsequent segment (word) that starts with an uppercase letter or a digit. It also splits if followed immediately by another sentence terminator or the end of the input text. Periods used mid-abbreviation (e.g., the first period in 'U.S.A.') do not end a sentence.

Example: "Dr. Kibobo is here. We are done." => ['Dr. Kibobo is here.', 'We are done.'] (The period after 'Dr.' does not split; the split occurs after 'here.').

Example: "We are visiting the U.K. It's fun!" => ['We are visiting the U.K.', "It's fun!"] (Split occurs because 'U.K.' is followed by space and uppercase 'I').

Implementation Guidance: Due to the complexity of multi-period abbreviations (e.g., "U.S.A.", "i.e."), using simple regular expression splitting on terminators alone will fail. You must use a strategy (like a state machine or sequential parsing with lookahead) that prioritizes the identification of full known abbreviations before checking for sentence-ending capitalization rules.

II. Word Counting
A word is a token identified by a robust Regular Expression (TOKEN_REGEX) that ensures consistency between rules. The underscore character (_) is a separator, NOT a word character.

Token Definition (A word is one of the following three consecutive tokens):

Signed Numbers: A hyphen followed by one or more digits (-10 is one word).

Compound/Contractions: One or more consecutive Unicode Letters/Digits that may contain internal Hyphens (well-known) or Apostrophes (don't).

Isolated Hyphens: A hyphen separated from letters/digits by whitespace or other separators (- in 4 - 2).

Implementation notes:

Use Python's built-in re module.

Do not use unsupported Unicode property escapes like \p{L} or \p{N}.

Use re.UNICODE flag.

Sentence      Word Count    Rationale

"Hello world!"            2              Standard split.

"ChineseExample!"   1   Chinese characters count as one word token.

"The score was 4 - 2."    6    ['The', 'score', 'was', '4', '-', '2'] (Isolated hyphen counted.)

"-10 degrees outside."    3      ['-10', 'degrees', 'outside'] (Signed number counted as one word.)

"hello_world"     2             Underscore is a separator.

III. Special Characters
Special characters are all non-alphanumeric, non-space characters (punctuation, symbols, emojis).

Behavior:

If per_sentence=False: return total count over raw input string.

If per_sentence=True: return dictionary mapping each extracted sentence to its special character count.

If no valid sentences are provided, raise TextStatsError("No valid sentences") (when per_sentence=True).

Example:

text = "Hello! #2025."

Special characters in raw text are '!', '#' and '.' (Count: 3)

stats.special_character_count(per_sentence=True)

{"Hello!": 1, "#2025.": 2} (The text must end in a terminator to yield valid sentences)

IV. Text Sanitization 
Optional text cleaning of raw text:

lowercase=True: convert all letters to lowercase.

remove_punctuation=True: remove punctuation using the following two-step process:

Initial Cleanup: Remove all common punctuation (from string.punctuation) except the hyphen (-) and apostrophe ('). Emojis and non-standard Unicode symbols must be preserved.

Apostrophe Stripping: After the initial cleanup, the resulting string must be tokenized by whitespace. For every token that contains a letter or digit, remove any leading or trailing apostrophes. Internal apostrophes are preserved.

Standalone hyphens (-) are preserved.

Example:

text = "Hello 'World'! It's a well-known fact."

stats.sanitize_text(lowercase=True, remove_punctuation=True)

Output: "hello world it's a well-known fact"

Rationale: '!' and '.' removed. Leading/trailing '\'' around 'World' removed. Internal 's preserved. Hyphen preserved.

V. Internal State & Errors
Lazy Loading and Caching. The method extract_sentences() is resource-intensive and must run at most once per instance of TextStatsPro.

Caching: The result of extract_sentences() MUST be stored internally on the instance (e.g., in self.sentences or self._sentences).

Lazy Loading Enforcement : Sentence-dependent analysis functions (total_words, special_character_count when per_sentence=True, etc.) MUST check the instance's cache directly and only invoke self.extract_sentences() if the sentences have not yet been extracted. This ensures extract_sentences() is only ever called once across all dependent method usage.

Error Handling: If extract_sentences() is called and finds no valid sentences in the text (after filtering whitespace, emojis, etc.), it MUST raise a TextStatsError with the message: "No valid sentences". Dependent functions must propagate this error if they rely on the sentences.

Class Skeleton
class TextStatsError(Exception):
    pass

class TextStatsPro:
    def __init__(self, text: str):
        pass

    def extract_sentences(self) -> list[str]:
        """
        Extract sentences from text.
        Strips whitespace, handles abbreviations, ignores blank sentences.
        Raises TextStatsError if no valid sentences exist.
        """
        pass

    def total_words(self) -> dict[str, int]:
        """
        Returns a dictionary mapping each sentence to its word count.
        """
        pass

    def special_character_count(self, per_sentence: bool = False) -> int | dict[str, int]:
        """
        Counts all non-alphanumeric, non-space characters (punctuation, symbols, emojis).
        Returns total count or per-sentence dictionary.
        Raises TextStatsError if no valid sentences exist (for per_sentence=True).
        """
        pass

    def sanitize_text(self, lowercase: bool = False, remove_punctuation: bool = False) -> str:
        """
        Returns the sanitized string depending on the lowercase and remove_punctuation flags.
        Hyphens within words, internal apostrophes, emojis, and whitespace are preserved.
        """
        pass

Example Usage
if __name__ == "__main__":
    text = "Hello world! How are you?"
    stats = TextStatsPro(text)

    print(stats.extract_sentences())
    # ["Hello world!", "How are you?"]

    print(stats.total_words())
    # {"Hello world!": 2, "How are you?": 3}

    print(stats.special_character_count())
    # 2 for '!' and '?'

    print(stats.sanitize_text(lowercase=True, remove_punctuation=True))
    # "hello world how are you"
