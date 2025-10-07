from __future__ import annotations

class TextStatsError(Exception):
	pass


class TextStatsPro:
	def __init__(self, text: str):
		self.text = text
		self._sentences: list[str] | None = None

	def extract_sentences(self) -> list[str]:
		"""
		Extract sentences from text.
		Strips whitespace, handles abbreviations, ignores blank sentences.
		Raises TextStatsError if no valid sentences exist.
		"""
		raise NotImplementedError

	def total_words(self) -> dict[str, int]:
		"""
		Returns a dictionary mapping each sentence to its word count.
		"""
		raise NotImplementedError

	def special_character_count(self, per_sentence: bool = False) -> int | dict[str, int]:
		"""
		Counts all non-alphanumeric, non-space characters (punctuation, symbols, emojis).
		Returns total count or per-sentence dictionary.
		Raises TextStatsError if no valid sentences exist (for per_sentence=True).
		"""
		raise NotImplementedError

	def sanitize_text(self, lowercase: bool = False, remove_punctuation: bool = False) -> str:
		"""
		Returns the sanitized string depending on the lowercase and remove_punctuation flags.
		Hyphens within words, internal apostrophes, emojis, and whitespace are preserved.
		"""
		raise NotImplementedError
