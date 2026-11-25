# Third-party notices

This project uses the following third-party software and data.

## React, React DOM, Scheduler

- Packages: `react` 19.3.0, `react-dom` 19.3.0, `scheduler` 0.28.0
- Source: https://github.com/facebook/react
- License: MIT

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Mediabunny

- Package: `mediabunny` 1.61.0, used unmodified
- Source: https://github.com/Vanilagy/mediabunny
- License: Mozilla Public License 2.0 (MPL-2.0), https://mozilla.org/MPL/2.0/

Mediabunny is included in builds of this project without changes. Its source code is available at the address above and in the `mediabunny` npm package. The MPL-2.0 applies to Mediabunny's files only, not to the rest of this project.

## OpenCC

- Used for: the traditional-to-simplified Chinese character tables in `shared/segment/t2s.js` and `web/src/core/dictation/hanFold.gen.js`, derived from OpenCC's conversion data
- Source: https://github.com/BYVoid/OpenCC
- Copyright: Carbo Kuo (BYVoid) and OpenCC contributors
- License: Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0

The tables were generated from OpenCC data and reformatted as JavaScript string literals.

## Build tools (not included in builds)

`vite` and `@vitejs/plugin-react` (MIT) are used only to build the project.
