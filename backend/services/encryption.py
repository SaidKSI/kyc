"""
Fernet-based encryption for PII fields in extracted_fields.
Encrypts to a base64-encoded blob on write; decrypts on read.
"""
import base64
import json
from cryptography.fernet import Fernet, InvalidToken

from core.config import settings


def _get_cipher():
    """Get or generate the Fernet cipher."""
    key = settings.fernet_key.encode() if isinstance(settings.fernet_key, str) else settings.fernet_key
    return Fernet(key)


def encrypt_fields(fields_dict: dict | None) -> str | None:
    """
    Encrypt a dict of extracted fields to a Fernet blob.
    Returns base64-encoded ciphertext, or None if input is None.
    """
    if fields_dict is None:
        return None
    try:
        plain_json = json.dumps(fields_dict, default=str)
        cipher = _get_cipher()
        ciphertext = cipher.encrypt(plain_json.encode())
        return ciphertext.decode('utf-8')
    except Exception as e:
        raise ValueError(f"Failed to encrypt fields: {e}") from e


def decrypt_fields(ciphertext: str | None) -> dict | None:
    """
    Decrypt a Fernet blob back to a dict.
    Returns None if input is None.
    Raises ValueError if ciphertext is invalid.
    """
    if ciphertext is None:
        return None
    try:
        cipher = _get_cipher()
        plain_json = cipher.decrypt(ciphertext.encode()).decode('utf-8')
        return json.loads(plain_json)
    except InvalidToken:
        raise ValueError("Decryption failed: invalid token or wrong key")
    except Exception as e:
        raise ValueError(f"Failed to decrypt fields: {e}") from e
