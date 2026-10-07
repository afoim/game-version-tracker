import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('research', Path(__file__).parents[1] / 'agent/chatgpt-version-research.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FinalAnswerTests(unittest.TestCase):
    def setUp(self):
        self.answer = dict(game_name='鸣潮', current_version='3.7', next_version='3.8（预计）',
                           current_release_date='2026-09-30', next_release_date=None,
                           next_release_kind='estimate', cycle_days=42, cycle_basis='用户指定42天',
                           current_content=['新角色心'], preview_published=False,
                           sources=[dict(url='https://mc.kurogames.com/main', title='更新公告', quote='9月30日更新', claims=['current_version'])])

    def test_valid_final(self):
        self.assertEqual(module.parse_final(json.dumps(self.answer), '鸣潮')['cycle_days'], 42)

    def test_reject_wrong_game(self):
        with self.assertRaises(ValueError): module.parse_final(json.dumps(self.answer), '原神')

    def test_reject_missing_versions_or_content(self):
        for key in ('current_version', 'next_version', 'current_content'):
            bad = dict(self.answer, **{key: None})
            with self.assertRaises(ValueError): module.parse_final(json.dumps(bad), '鸣潮')

    def test_reject_invalid_dates_cycles_and_bool(self):
        for key, value in [('current_release_date', '2026-02-30'), ('cycle_days', True), ('cycle_days', 900), ('preview_published', 'false')]:
            with self.assertRaises(ValueError): module.parse_final(json.dumps(dict(self.answer, **{key: value})), '鸣潮')

    def test_reject_unsafe_or_incomplete_sources(self):
        for url in ('file:///etc/passwd', 'https://user:secret@example.com', 'http://mc.kurogames.com'):
            bad = dict(self.answer, sources=[dict(self.answer['sources'][0], url=url)])
            with self.assertRaises(ValueError): module.parse_final(json.dumps(bad), '鸣潮')

if __name__ == '__main__': unittest.main()
