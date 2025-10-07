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
		# Return cached if available
		if self._sentences is not None:
			return self._sentences

		text = self.text
		if text is None:
			text = ""

		# Must contain at least one potential terminator
		if not any(ch in text for ch in ".!?"):
			raise TextStatsError("No valid sentences")

		# Known abbreviations
		title_abbr = {"mr.", "mrs.", "dr.", "ms.", "jr.", "sr."}
		general_abbr_words = {"i.e.", "e.g.", "vs."}

		import re

		def ends_with_title_abbr(prefix: str) -> bool:
			# Check last token ending with a period matches a known title abbreviation
			m = re.search(r"(\b[A-Za-z]{2,3}\.)\s*$", prefix)
			return bool(m and m.group(1).lower() in title_abbr)

		def ends_with_general_abbr(prefix: str) -> bool:
			# Match common forms like i.e., e.g., vs. or multi-letter acronyms like U.S.A.
			if re.search(r"(\b(?:i\.e\.|e\.g\.|vs\.)\s*$)", prefix, flags=re.IGNORECASE):
				return True
			# Multi-period acronyms like U.S.A. or U.K.
			return bool(re.search(r"\b(?:[A-Za-z]\.){2,}\s*$", prefix))

		boundaries: list[int] = []
		# Find runs of terminators
		for m in re.finditer(r"[.!?]+", text):
			seq = m.group(0)
			end = m.end()
			# If contains ! or ?, always a boundary at the end of the run
			if any(c in seq for c in "!?"):
				boundaries.append(end)
				continue
			# Only periods run
			prefix = text[:m.start()+1]  # include the first period in this run
			after = text[m.end():]
			# If this period is immediately followed by a letter and then another period,
			# we are in the middle of a multi-period abbreviation like U.S.A. or i.e.
			if re.match(r"^[A-Za-z]\.", after):
				continue
			# Title abbreviations never end a sentence
			if ends_with_title_abbr(prefix):
				continue
			# General abbr: split only under specific lookahead conditions
			if ends_with_general_abbr(prefix):
				# Condition: whitespace + Uppercase/Digit starts next segment
				cond1 = bool(re.match(r"^\s+[A-Z0-9]", after))
				# Or immediately followed by another terminator
				cond2 = bool(after and after[0] in ".!?" )
				# Or end of text
				cond3 = after == ""
				if cond1 or cond2 or cond3:
					boundaries.append(end)
				continue
			# Regular period(s): treat as boundary at the end of the run
			boundaries.append(end)

		# Slice sentences using boundaries
		start = 0
		result: list[str] = []
		for b in boundaries:
			segment = text[start:b]
			segment = segment.strip()
			if segment:
				# Validate non-blank: must contain at least one letter or digit
				if any(ch.isalnum() for ch in segment):
					result.append(segment)
			start = b

		# If nothing valid, error
		if not result:
			raise TextStatsError("No valid sentences")

		self._sentences = result
		return result

	def total_words(self) -> dict[str, int]:
		"""
		Returns a dictionary mapping each sentence to its word count.
		"""
		import re
		# Lazy load sentences
		if self._sentences is None:
			self.extract_sentences()

		assert self._sentences is not None
		if not self._sentences:
			raise TextStatsError("No valid sentences")

		# Token rules: signed numbers, compounds with internal hyphens/apostrophes, isolated hyphen
		# [^\W_] == Unicode letters/digits (exclude underscore)
		token_regex = re.compile(r"-(?=\d)\d+|[^\W_]+(?:[-'][^\W_]+)*|-", flags=re.UNICODE)

		counts: dict[str, int] = {}
		for s in self._sentences:
			tokens = token_regex.findall(s)
			# Filter out underscores-only tokens implicitly excluded by regex
			counts[s] = len(tokens)
		return counts

	def special_character_count(self, per_sentence: bool = False) -> int | dict[str, int]:
		"""
		Counts all non-alphanumeric, non-space characters (punctuation, symbols, emojis).
		Returns total count or per-sentence dictionary.
		Raises TextStatsError if no valid sentences exist (for per_sentence=True).
		"""
		def count_specials(s: str) -> int:
			return sum(1 for ch in s if (not ch.isalnum()) and (not ch.isspace()))

		if not per_sentence:
			return count_specials(self.text or "")

		# Per sentence requires valid sentences
		if self._sentences is None:
			self.extract_sentences()
		assert self._sentences is not None
		if not self._sentences:
			raise TextStatsError("No valid sentences")
		return {s: count_specials(s) for s in self._sentences}

	def sanitize_text(self, lowercase: bool = False, remove_punctuation: bool = False) -> str:
		"""
		Returns the sanitized string depending on the lowercase and remove_punctuation flags.
		Hyphens within words, internal apostrophes, emojis, and whitespace are preserved.
		"""
		import string
		import re

		s = self.text or ""
		if lowercase:
			s = s.lower()

		if remove_punctuation:
			# Remove all punctuation except hyphen and apostrophe
			preserve = {"-", "'"}
			remove_chars = {c for c in string.punctuation if c not in preserve}
			if remove_chars:
				trans = str.maketrans({c: "" for c in remove_chars})
				s = s.translate(trans)

			# Strip leading/trailing apostrophes around tokens that contain a letter or digit,
			# while preserving internal apostrophes and whitespace/emojis.
			parts = re.split(r"(\s+)", s)
			for i in range(0, len(parts), 2):
				tok = parts[i]
				if not tok:
					continue
				if any(ch.isalnum() for ch in tok):
					# Remove leading/trailing apostrophes only
					start = 0
					end = len(tok)
					while start < end and tok[start] == "'":
						start += 1
					while end > start and tok[end - 1] == "'":
						end -= 1
					parts[i] = tok[start:end]
			s = "".join(parts)

		return s
