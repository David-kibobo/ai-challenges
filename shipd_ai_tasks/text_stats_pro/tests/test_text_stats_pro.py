# -*- coding: utf-8 -*-
import unittest

class TestTextStatsPro(unittest.TestCase):

    def test_empty_text_raises_error(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro("").extract_sentences()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_whitespace_only_text_raises_error(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro("    ").extract_sentences()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_text_without_terminators_raises_error(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro("a phrase without a period").extract_sentences()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_only_blank_sentences_raise_error(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        text = ". !? ."
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro(text).extract_sentences()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_total_words_raises_error_no_valid_sentences(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro("").total_words()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_special_character_count_per_sentence_raises_error_no_valid_sentences(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro("    ").special_character_count(per_sentence=True)
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_total_words_only_terminators_and_whitespace(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        text = "... ? !"
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro(text).total_words()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_basic_sentence_extraction(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello world! How are you? Dr. Kibobo is here."
        stats = TextStatsPro(text)
        expected = ["Hello world!", "How are you?", "Dr. Kibobo is here."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentences_with_abbreviations(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "I met Mr. Jones. He is nice. U.S.A. is large."
        stats = TextStatsPro(text)
        expected = ["I met Mr. Jones.", "He is nice.", "U.S.A. is large."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentence_extraction_with_abbreviation(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "We are visiting the U.K."
        stats = TextStatsPro(text)
        expected = ["We are visiting the U.K."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_general_abbr_conditional_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "The treaty involved the U.K. It was signed yesterday."
        stats = TextStatsPro(text)
        expected = ["The treaty involved the U.K.", "It was signed yesterday."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_general_abbr_no_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "This is a test, i.e. an example."
        stats = TextStatsPro(text)
        expected = ["This is a test, i.e. an example."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_general_abbr_spec_example_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "We are visiting the U.K. It's fun!"
        stats = TextStatsPro(text)
        expected = ['We are visiting the U.K.', "It's fun!"]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_general_abbr_lowercase_no_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "This is about the U.K. and its history."
        stats = TextStatsPro(text)
        expected = ["This is about the U.K. and its history."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_general_abbr_followed_by_digit_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Test in the U.K. 2024 results were good."
        stats = TextStatsPro(text)
        expected = ["Test in the U.K.", "2024 results were good."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_title_abbreviations_no_split(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Mrs. Adams called this morning. Ms. Brown and Jr. went home after Sr. finished."
        stats = TextStatsPro(text)
        expected = [
            "Mrs. Adams called this morning.",
            "Ms. Brown and Jr. went home after Sr. finished."
        ]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentences_with_consecutive_terminators(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Wow!! Really? Yes..."
        stats = TextStatsPro(text)
        expected = ["Wow!!", "Really?", "Yes..."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentences_with_whitespace_and_newlines(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "    Leading space.\nTrailing space!    \nNewline here?\n"
        stats = TextStatsPro(text)
        expected = ["Leading space.", "Trailing space!", "Newline here?"]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_handling_empty_sentences(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello world! . How are you?"
        stats = TextStatsPro(text)
        expected = ["Hello world!", "How are you?"]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentence_with_only_underscore_should_be_invalid(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        text = "_."
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro(text).extract_sentences()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_sentence_extraction_abbr_followed_by_terminator(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "He saw Dr. Smith! We are ready."
        stats = TextStatsPro(text)
        expected = ['He saw Dr. Smith!', 'We are ready.']
        self.assertEqual(stats.extract_sentences(), expected)

    def test_sentence_extraction_emoji_only_skipped(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "First sentence. \U0001F44D! Second sentence."
        stats = TextStatsPro(text)
        expected = ["First sentence.", "Second sentence."]
        self.assertEqual(stats.extract_sentences(), expected)

    def test_word_count_basic(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello world! Don't stop."
        stats = TextStatsPro(text)
        expected = {"Hello world!": 2, "Don't stop.": 2}
        self.assertEqual(stats.total_words(), expected)

    def test_word_count_hyphens_contractions(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Well-known authors shouldn't fail."
        stats = TextStatsPro(text)
        expected = {"Well-known authors shouldn't fail.": 4}
        self.assertEqual(stats.total_words(), expected)

    def test_numbers_and_special_chars_in_sentences(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "2 + 2 = 4."
        stats = TextStatsPro(text)
        expected_words = {"2 + 2 = 4.": 3}
        self.assertEqual(stats.total_words(), expected_words)
        expected_specials = {"2 + 2 = 4.": 3}
        self.assertEqual(stats.special_character_count(per_sentence=True), expected_specials)

    def test_multiple_spaces_and_tabs(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello  world!\tThis  is  fun."
        stats = TextStatsPro(text)
        expected = {"Hello  world!": 2, "This  is  fun.": 3}
        self.assertEqual(stats.total_words(), expected)

    def test_total_words_non_blank_zero_word_sentence(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro, TextStatsError
        text = "!@#$%&?"
        with self.assertRaises(TextStatsError) as ctx:
            TextStatsPro(text).total_words()
        self.assertEqual(str(ctx.exception), "No valid sentences")

    def test_total_words_standalone_hyphen(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "The score was 4 - 2."
        stats = TextStatsPro(text)
        expected = {"The score was 4 - 2.": 6}
        self.assertEqual(stats.total_words(), expected)

    def test_word_count_possessive_apostrophe(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "The dog's bone is here."
        stats = TextStatsPro(text)
        expected = {"The dog's bone is here.": 5}
        self.assertEqual(stats.total_words(), expected)

    def test_word_count_leading_hyphen(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "-10 degrees outside."
        stats = TextStatsPro(text)
        expected = {"-10 degrees outside.": 3}
        self.assertEqual(stats.total_words(), expected)

    def test_total_words_with_complex_word(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "This is a state-of-the-art-v2 example."
        stats = TextStatsPro(text)
        self.assertEqual(
            stats.total_words(), {"This is a state-of-the-art-v2 example.": 5}
        )

    def test_word_count_underscore_separator(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "hello_world."
        stats = TextStatsPro(text)
        expected = {"hello_world.": 2}
        self.assertEqual(stats.total_words(), expected)

    def test_special_character_count_total(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello! #2025"
        stats = TextStatsPro(text)
        self.assertEqual(stats.special_character_count(), 2)

    def test_special_character_count_per_sentence(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hi! Hello \U0001F600."
        stats = TextStatsPro(text)
        expected = {"Hi!": 1, "Hello \U0001F600.": 2}
        self.assertEqual(stats.special_character_count(per_sentence=True), expected)

    def test_special_character_count_spec_example(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello! #2025."
        stats = TextStatsPro(text)
        self.assertEqual(stats.special_character_count(per_sentence=False), 3)
        expected = {"Hello!": 1, "#2025.": 2}
        self.assertEqual(stats.special_character_count(per_sentence=True), expected)

    def test_special_character_count_total_no_valid_sentences(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "###$$$"
        stats = TextStatsPro(text)
        self.assertEqual(stats.special_character_count(per_sentence=False), 6)

    def test_multilingual_text_handling(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello world! \u4F60\u597D\u4E16\u754C! \U0001F44B"
        stats = TextStatsPro(text)
        expected_sentences = ["Hello world!", "\u4F60\u597D\u4E16\u754C!"]
        self.assertEqual(stats.extract_sentences(), expected_sentences)
        expected_specials = {"Hello world!": 1, "\u4F60\u597D\u4E16\u754C!": 1}
        self.assertEqual(stats.special_character_count(per_sentence=True), expected_specials)
        expected_words = {"Hello world!": 2, "\u4F60\u597D\u4E16\u754C!": 1}
        self.assertEqual(stats.total_words(), expected_words)

    def test_sanitize_lowercase(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello WORLD!"
        stats = TextStatsPro(text)
        self.assertEqual(stats.sanitize_text(lowercase=True), "hello world!")

    def test_sanitize_remove_punctuation(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello, world! \U0001F44D"
        stats = TextStatsPro(text)
        self.assertEqual(stats.sanitize_text(remove_punctuation=True), "Hello world \U0001F44D")

    def test_sanitize_lowercase_and_remove_punctuation(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Good-BYE, World! \U0001F44D"
        stats = TextStatsPro(text)
        self.assertEqual(
            stats.sanitize_text(lowercase=True, remove_punctuation=True),
            "good-bye world \U0001F44D"
        )

    def test_sanitize_remove_punctuation_on_contractions(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "don't stop!"
        stats = TextStatsPro(text)
        expected = "don't stop"
        self.assertEqual(stats.sanitize_text(remove_punctuation=True), expected)

        
    def test_sanitize_text_preserves_standalone_hyphen(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        txt = "The score was 4 - 2."
        result = TextStatsPro(txt).sanitize_text(remove_punctuation=True)
        self.assertEqual(result, "The score was 4 - 2")
    

    def test_sanitize_preserve_all_apostrophes(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "'don't'!"
        stats = TextStatsPro(text)
        expected = "don't"
        self.assertEqual(
            stats.sanitize_text(lowercase=True, remove_punctuation=True),
            expected
        )

    def test_sanitize_spec_example(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        text = "Hello 'World'! It's a well-known fact. \U0001F44B"
        stats = TextStatsPro(text)
        expected = "hello world it's a well-known fact \U0001F44B"
        self.assertEqual(
            stats.sanitize_text(lowercase=True, remove_punctuation=True),
            expected
        )

    def test_extract_sentences_caching(self):
        from shipd_ai_tasks.text_stats_pro.text_stats_pro import TextStatsPro
        from unittest.mock import patch
        text = "Caching works! Right?"
        stats = TextStatsPro(text)
        with patch.object(TextStatsPro, "extract_sentences", wraps=stats.extract_sentences) as spy:
            stats.total_words()
            stats.special_character_count(per_sentence=True)
            self.assertEqual(spy.call_count, 1)


if __name__ == "__main__":
    unittest.main()
