# Cenote — Brand

## Concepto

Un **cenote** es un pozo natural en la roca caliza que revela aguas subterráneas que llevan ahí siempre, ocultas. Es la metáfora perfecta para Cenote el producto: lo que Terraform declara es solo la superficie; lo que AWS realmente tiene vive debajo.

El logo son **dos círculos concéntricos pero ligeramente desplazados** — la abertura del cenote (vista declarada) y el reflejo del agua (estado real). El desfase entre ambos es la metáfora visual del **drift**. El punto rojo señala el momento en que las dos vistas no concuerdan.

Origen del nombre: del maya yucateco *ts'onot* / *dzonot*. Conecta con la identidad mexicana sin caer en cliché.

## Palette
| Token | Hex | Uso |
|---|---|---|
| `ink-950` | `#0a0a0a` | Background dark mode, ink primario |
| `ink-50` | `#fafafa` | Background light mode |
| `surface` | `#f9fafb` | App background |
| `card` | `#ffffff` | Card surface |
| `border` | `#e2e8f0` (slate-200/50) | Bordes |
| `state-matched` | `#10b981` | Recurso TF↔AWS sin drift |
| `state-drift` | `#ef4444` | Drift detectado |
| `state-tf-only` | `#94a3b8` | Declarado en TF, no existe en AWS |
| `state-aws-only` | `#f59e0b` | Existe en AWS, no está en TF (huérfano) |
| `accent` | `#0a0a0a` | Botones primarios (sin púrpura/azul AI) |

## Typography
- **Display & UI:** Geist (Sans)
- **Code & data:** Geist Mono
- **Tracking:** `tracking-tight` para headers, `tracking-tighter` para display

## Iconos
`@phosphor-icons/react` con `weight="duotone"` o `weight="regular"`, `strokeWidth=1.5` cuando aplique.

## Logo files
- `logo.svg` — Logotipo horizontal (mark + wordmark)
- `mark.svg` — Solo símbolo (cuadrado, isotipo)
- `mark-light.svg` — Símbolo sobre fondo claro
- `favicon.svg` — Versión optimizada para 16-32px
- `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png`, `android-chrome-{192,512}.png` — generadas con `sharp` (script en `scripts/generate-favicons.js`)

## Tagline
**drift · diff · authorship**

Tres palabras, tres features. Sin "elevate", sin "seamless", sin "next-gen".

## Tono de voz
- Directo, técnico, sin AI-slop.
- Verbos concretos: "detecta", "reconcilia", "atribuye".
- Inglés por default en código y UI; español en docs internas si aplica.
