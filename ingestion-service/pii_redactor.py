import re

PII_PATTERNS = [
    (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]'),
    (r'\b\d{10,12}\b', '[PHONE]'),
    (r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', '[CARD]'),
    (r'\b\d{3}-\d{2}-\d{4}\b', '[SSN]'),
    (r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b', '[PAN]'),   # Indian PAN
    (r'\b\d{12}\b', '[AADHAAR]'),                   # Indian Aadhaar
]

def redact_pii(text: str) -> str:
    if not text:
        return text
    for pattern, replacement in PII_PATTERNS:
        text = re.sub(pattern, replacement, text)
    return text