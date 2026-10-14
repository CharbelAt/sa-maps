# Optional: the real HUD font

The money counter, clock and "Mission passed!" text are designed for **Pricedown**
(a free font by Typodermic / Ray Larabie). It isn't bundled here because its license
doesn't clearly allow redistributing the file in a public repo.

- **On a device with Pricedown installed** it's picked up automatically.
- **To ship it with the site yourself**: put `pricedown.woff2` in this folder and change the
  `@font-face` rule at the top of `css/sa.css` to:

  ```css
  @font-face {
    font-family: 'Pricedown';
    src: local('Pricedown'), url('../fonts/pricedown.woff2') format('woff2');
  }
  ```

Without it the HUD falls back to Anton (Google Fonts), which looks close enough.
