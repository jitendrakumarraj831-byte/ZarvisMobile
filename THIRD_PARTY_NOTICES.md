# Third-party notices

What this repository contains that is not original to it, where it comes from, and what its licence
says. This is a record of facts and of the licence's own words, not legal advice: where a question
needs a lawyer, it says so.

## `backend/src/tts/edgeToken.ts` — derived from `edge-tts` (LGPL-3.0)

| | |
|---|---|
| What | A TypeScript port of `generate_sec_ms_gec_v2` and the functions under it in `src/edge_tts/drm.py`: the `Sec-MS-GEC` token that Microsoft's "Read Aloud" speech service wants in its connection URL. |
| Upstream | `edge-tts` 7.3.1, <https://github.com/rany2/edge-tts>, published on PyPI on 2026-10-13. |
| Upstream's licence statement | The `LICENSE` file shipped in the 7.3.1 source distribution begins: *"The MIT license is used for 'src/edge_tts/srt_composer.py' only. All remaining files are licensed under the LGPLv3."* `drm.py` is not `srt_composer.py`, so it is LGPL-3.0. The package metadata carries the classifier `License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)`. Copyright lines in that file: Christopher Down (2014-2023) and rany (2025-). |
| How it was read | The upstream source was read on 2026-10-14 and the arithmetic ported operation by operation. The port was checked against the upstream function itself: `backend/test/tts/edgeToken.test.ts` holds the tokens that the unmodified Python function produced for fixed times (412 times, four years apart, agreed when written). |
| Is it a derivative? | It is a translation of a licensed work into another language, which copyright law and the licence treat as an adaptation ("modify" in the GPL's definitions, which the LGPL incorporates). The file's header says so and keeps the notice. |
| Where the file goes | Only the backend. The Android app and the web client do not contain it. The backend is run as a service; this repository is **public** on GitHub, so the file's source is available to anyone who can open the repository. |
| What the licence asks, in its own words | LGPL-3.0 §2: a modified version of the Library may be conveyed *under this License* (or under the GNU GPL). §4: a Combined Work may be conveyed under terms of your choice that do not restrict modification of the Library's portions and reverse engineering for debugging such modifications, if you *"Give prominent notice with each copy of the Combined Work that the Library is used in it and that the Library and its use are covered by this License"* and *"Accompany the Combined Work with a copy of the GNU GPL and this license document"*, and then either convey the Minimal Corresponding Source and the Corresponding Application Code in a form that lets the user recombine or relink the Application with a modified Library, or use a suitable shared-library mechanism (§4 d), plus Installation Information where the GPL's §6 would require it (§4 e). The full text is in `LICENSES/LGPL-3.0.txt`; the GPL it points to is in `LICENSES/GPL-3.0.txt`. |
| What this repository does | Keeps the notice in the file header, names the upstream and its licence there and here, ships both licence texts in `LICENSES/`, and keeps the source of the file public. |
| What is **not** settled here | Whether publishing the repository, or deploying the backend, counts as "conveying" a Combined Work for §4, and what that would require of the rest of the backend, is a legal question this record does not answer. The GNU project's own explanation of when the GPL family applies to hosted services is the thing to read, with a lawyer if the answer matters to a release. Two ways to avoid the question entirely, if it does: replace the file with an implementation written from a description of the token rather than from upstream's source, or drop Edge's voice and use only the Gemini voice (`TTS_PROVIDER=gemini`). |

Separately from the licence: the service the token is for is Microsoft's, is undocumented, and is
reached here without an account, a key or a contract. Nothing in this notice grants any right to use
it. See `PRIVACY.md` ("Spoken replies") and `AI_MODEL_GATEWAY.md` §2.14.

## Production dependencies

A scan of the `package.json` licence field of the 133 packages the backend loads in production
(`npm ls --omit=dev --all`, 2026-10-14) found MIT (114), ISC (5), BSD-2/3-Clause (7), Apache-2.0 (2),
`MIT AND Zlib` (1), BSD (1), and two older-style entries that name MIT. One package offers a choice:
`jszip` is `(MIT OR GPL-3.0-or-later)`; this project uses it under the MIT option (it is a dependency
of `mammoth`). No other production package declares a copyleft licence.

**To check, not checked here:** `mpg123-decoder` 1.0.3 declares MIT, and its README says it is
*"Based on mpg123"*, compiled to WebAssembly. mpg123 has its own licence, which this package does not
restate and which was not looked up from this environment. If it is LGPL, the same questions as above
apply to that binary.

Licences of the Android (Gradle) dependencies and of the web client's bundled assets were not scanned
in this review.
