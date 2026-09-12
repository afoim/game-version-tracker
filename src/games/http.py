"""Bounded retries for transient source failures; parsing errors stay visible."""
import time
import urllib.error
import urllib.request


def get_text(url: str) -> str:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 game-version-tracker/0.1",
            })
            with urllib.request.urlopen(request, timeout=20) as response:
                text = response.read().decode("utf-8")
            if "aliyun_waf_aa" in text:
                raise urllib.error.URLError("Source returned a WAF challenge instead of announcements")
            return text
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)
