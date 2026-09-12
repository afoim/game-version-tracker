import datetime as dt
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from games.wuwa import parse_page, UTC8
from games.http import get_text
from main import collect_all, write_payload

NOW = dt.datetime(2026, 9, 12, 16, tzinfo=UTC8)
LIVE = '<p>《鸣潮》3.6版本「蜃云灯影，凡尘剑心」已正式开启！</p>'
PREVIEW = '<p>《鸣潮》3.7版本前瞻通讯将于2026年9月19日19:00正式播出。</p>'


class VersionTests(unittest.TestCase):
    def test_future_preview_does_not_replace_current(self):
        result = parse_page(PREVIEW + LIVE, NOW)
        self.assertEqual(result['current']['version'], '3.6')
        self.assertEqual(result['next']['version'], '3.7')
        self.assertTrue(result['preview']['announced'])
        self.assertEqual(result['preview']['scheduled_at'], '2026-09-19T19:00:00+08:00')

    def test_no_cross_announcement_match(self):
        result = parse_page('<p>《鸣潮》3.7版本前瞻</p>' + LIVE, NOW)
        self.assertEqual(result['current']['version'], '3.6')

    def test_preview_alone_is_not_a_current_release(self):
        with self.assertRaisesRegex(RuntimeError, 'No explicitly launched'):
            parse_page(PREVIEW, NOW)

    def test_scripts_cannot_inject_release(self):
        result = parse_page(LIVE + '<script>《鸣潮》9.9版本正式上线</script>', NOW)
        self.assertEqual(result['current']['version'], '3.6')

    def test_unknown_live_release_never_reuses_old_date(self):
        with self.assertRaisesRegex(RuntimeError, 'launched version 3.7'):
            parse_page(LIVE + '<p>《鸣潮》3.7版本正式上线</p>', NOW)

    def test_explicit_launch_transitions_at_timestamp(self):
        page = LIVE + '<p>《鸣潮》3.7版本「新版本」将于2026年10月1日11:00正式开启</p>'
        before = parse_page(page, NOW)
        self.assertEqual(before['current']['version'], '3.6')
        self.assertTrue(before['next']['confirmed'])
        after = parse_page(page, dt.datetime(2026, 10, 1, 11, tzinfo=UTC8))
        self.assertEqual(after['current']['version'], '3.7')
        self.assertEqual(after['current']['start_at'], '2026-10-01T11:00:00+08:00')

    def test_year_boundary_and_numeric_version_order(self):
        page = '<p>《鸣潮》3.9版本将于2026年12月1日11:00开启</p><p>《鸣潮》3.10版本将于2027年1月1日11:00开启</p>'
        result = parse_page(page, dt.datetime(2027, 1, 2, tzinfo=UTC8))
        self.assertEqual(result['current']['version'], '3.10')

    def test_does_not_invent_unannounced_next_version(self):
        self.assertIsNone(parse_page(LIVE, NOW)['next']['version'])


class CollectionTests(unittest.TestCase):
    def test_failure_is_reported_after_remaining_adapters_run(self):
        bad = Mock(slug='broken')
        bad.collect.side_effect = RuntimeError('source unavailable')
        good = Mock(slug='working')
        with patch('main.normalize', return_value={'ok': True}):
            with self.assertRaisesRegex(RuntimeError, 'broken: RuntimeError'):
                collect_all([bad, good])
        good.collect.assert_called_once()

    def test_atomic_write_failure_preserves_existing_data(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'games.json'
            target.write_text('previous', encoding='utf-8')
            with patch('main.os.replace', side_effect=OSError('disk error')):
                with self.assertRaises(OSError):
                    write_payload(target, {'games': []})
            self.assertEqual(target.read_text(), 'previous')
            self.assertEqual(list(Path(folder).iterdir()), [target])

    @patch('games.http.time.sleep')
    @patch('games.http.urllib.request.urlopen')
    def test_network_failure_retries_then_recovers(self, urlopen, sleep):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'<p>ok</p>'
        urlopen.side_effect = [urllib.error.URLError('temporary'), response]
        self.assertEqual(get_text('https://example.com'), '<p>ok</p>')
        self.assertEqual(urlopen.call_count, 2)

    @patch('games.http.time.sleep')
    @patch('games.http.urllib.request.urlopen', side_effect=urllib.error.URLError('offline'))
    def test_network_failure_is_bounded(self, urlopen, sleep):
        with self.assertRaises(urllib.error.URLError):
            get_text('https://example.com')
        self.assertEqual(urlopen.call_count, 3)


if __name__ == '__main__':
    unittest.main()
