# Changelog

## 0.2.0 · 2026-10-05

**Security fix. Upgrade from 0.1.0, which is deprecated.**

In 0.1.0, the limits on step-up codes held only for calls made one after another. The gate read the try count, checked the code, then wrote the count back, so calls made in parallel all read the same count. In a test against 0.1.0 with its own `MemoryStore`:

- 200 wrong codes sent at once were all checked, and none locked the token.
- The right code sent among them succeeded.
- 10 parallel requests for a code sent 10 texts, despite the cap of 3.

Agents can call tools in parallel, so a model could try many codes per token, which is the case the gate exists to prevent.

- **Fixed:** a try is now reserved before the code is checked (`TokenStore.claimAttempt`). However many guesses arrive at once, no more than `maxAttempts` are ever compared.
- **Fixed:** sending a code counts it against `maxSends` and stores it in one step (`TokenStore.claimSend`).
- **Breaking, for custom stores only:** `TokenStore` has two new methods, `claimSend` and `claimAttempt`, and both must be atomic. The README shows each as one SQL statement. `MemoryStore` implements them.
- Tests: parallel guesses (including the right code after the tries are gone), a slow asynchronous store, and parallel requests for a code.

## 0.1.0 · 2026-10-03

First release: single-use, caller-bound tokens with an optional out-of-band step-up code.
