"""Content safety checks for a community used by minors.

This is deliberately conservative. The two things that actually cause harm in
a teenage community are (1) contact details moving into private channels and
(2) abuse. Everything here is a blunt first line, not a substitute for a human
moderator, and it is applied on the server so a modified client cannot skip it.
"""
import re

# Contact details. Blocking these keeps conversation on the public, moderated
# record instead of moving to a private chat nobody can see.
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.I)
_PHONE = re.compile(r"(?:\+?\d[\s.\-()]*){7,}")
_HANDLE = re.compile(
    r"\b(?:whats\s?app|wasap|telegram|snap(?:chat)?|insta(?:gram)?|discord|tiktok|facebook|messenger)\b",
    re.I,
)
_URL = re.compile(r"\b(?:https?://|www\.)\S+", re.I)

# Allow links to the places students are actually sent for learning.
_ALLOWED_HOSTS = (
    "developer.mozilla.org", "web.dev", "freecodecamp.org", "javascript.info",
    "react.dev", "theodinproject.com", "github.com", "stackoverflow.com",
    "cs50.harvard.edu", "learn.microsoft.com", "docs.python.org",
)

_ABUSE = re.compile(
    r"\b(kill\s+your ?self|kys|idiota|est[uú]pido|stupid|retard|loser|fat\s+\w+|ugly)\b",
    re.I,
)


def _link_is_allowed(url: str) -> bool:
    host = re.sub(r"^https?://", "", url, flags=re.I).split("/")[0].lower()
    host = host.replace("www.", "")
    return any(host == h or host.endswith("." + h) for h in _ALLOWED_HOSTS)


def check_text(text: str) -> str | None:
    """Return a human-readable reason to reject, or None if the text is fine."""
    if not text or not text.strip():
        return "There is nothing written here yet."
    if len(text) > 4000:
        return "That is longer than 4000 characters. Try to get to the point."

    if _EMAIL.search(text):
        return (
            "That looks like an email address. Keep the conversation here where "
            "a moderator can see it, and never share personal contact details."
        )
    if _PHONE.search(text):
        return (
            "That looks like a phone number. Never post one. Keep the "
            "conversation here where a moderator can see it."
        )
    if _HANDLE.search(text):
        return (
            "Do not move the conversation to a private app. Everything here is "
            "public on purpose, because that is what keeps it safe."
        )
    for url in _URL.findall(text):
        if not _link_is_allowed(url):
            return (
                "Links are limited to the learning sites the academy already "
                f"points to. {url} is not one of them."
            )
    if _ABUSE.search(text):
        return (
            "That reads as an insult. Ask about the code, not the person. "
            "Posts like this get accounts removed."
        )
    return None
