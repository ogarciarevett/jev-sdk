# Changelog

Notable changes to `@ogarciarevett/jev-sdk`. Releases are published from GitHub Releases; see
[RELEASING.md](RELEASING.md).

## 0.2.0 (2026-10-23)

Support for the experimental TypeSafe image models and Jev 1.14. Images and Box questions are
"dreamer-ready" upstream: the request format, answers and limits can change between releases.

### Added

- `images` on a judge request: reference -> PNG or JPEG bytes (`Uint8Array`), sent as request
  `assets`. Write the reference in the state, the instructions or the criteria where the image
  belongs. Every reference must survive masking. Image bytes are sent as they are (they are not text,
  so they are not masked) and are never written to the decision log.
- The `box` question type (Jev 1.14): a decided verdict is `"box"`, its value is the confidence, and
  `verdict.box` holds the `top`, `bottom`, `left` and `right` edges as fractions of the image.
- `JEV_BOX_MODEL` (`jev-1.14.0`) and a `model` field on the request. A box needs `jev-1.14.0` or
  `jev-preview`.
- The `TypeSafe-Danger-Zone-Images: true` header, sent automatically with every request that has an
  image or a box question.
- `longContext: true` sends `TypeSafe-Danger-Zone-Long-Context: true` and raises the state budget
  from 96,000 to 786,000 characters (262k tokens).

### Changed

- `JEV_QUESTION_TYPES` now includes `box`, and `JevMaskedRequest` carries `assets`, `model` and
  `longContext`. Code that switches over `JevQuestionType` should handle `box`.

## 0.1.0 (2026-10-05)

- First release.
