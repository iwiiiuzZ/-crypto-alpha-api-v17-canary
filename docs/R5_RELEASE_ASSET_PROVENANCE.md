# R5 release-package asset provenance and integrity gates

This is a packaging checklist, not a release approval. The CI-generated R5 candidate ZIP contains tested Worker code, tests, locked dependencies and operations files, **not** the user's original complete GPT knowledge and instructions. Do not distribute that candidate ZIP as a full GPT installation.

The final assembled release must additionally contain the original files from `Crypto_Alpha_V27_6_2_BackendFix(1).zip` under their original paths. Verify exact SHA-256 before copying:

| Original path | SHA-256 |
|---|---|
| `02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt` | `d1142d19864d75d4` (prefix) |
| `02_INSTRUCTIONS/CONVERSATION_STARTERS.txt` | `bf602fe07cb31ed0` (prefix) |
| `02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt` | `f357b0e9d779c316` (prefix) |
| `03_KNOWLEDGE/CRYPTO_ALPHA_V27_KNOWLEDGE_FULL.md` | `cc797964732217ae` (prefix) |
| `06_ACTION/openapi.json` | `cf0aa97a5a8a25ba` (prefix) |

Also include four operation IDs, sub-500-character opening prompt, release manifest, a read-only acceptance script, exact production source/deployment identity, rollback instructions and a limitations report. Never imply that unit tests prove production data feeds, notification delivery, installed GPT configuration, or strategy profitability.

R5 deployment is prohibited until a separate source-locked approval and full production acceptance are recorded. Do not modify production while generating the candidate package.
