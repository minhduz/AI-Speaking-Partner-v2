---
name: Vibrant Play
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#3f4a36'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f1f1f1'
  outline: '#6f7b64'
  outline-variant: '#becbb1'
  surface-tint: '#2b6c00'
  primary: '#2b6c00'
  on-primary: '#ffffff'
  primary-container: '#58cc02'
  on-primary-container: '#1e5000'
  inverse-primary: '#6be026'
  secondary: '#006590'
  on-secondary: '#ffffff'
  secondary-container: '#2fb8ff'
  on-secondary-container: '#004666'
  tertiary: '#8c5000'
  on-tertiary: '#ffffff'
  tertiary-container: '#ff9c27'
  on-tertiary-container: '#683a00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#87fe45'
  primary-fixed-dim: '#6be026'
  on-primary-fixed: '#082100'
  on-primary-fixed-variant: '#1f5100'
  secondary-fixed: '#c8e6ff'
  secondary-fixed-dim: '#88ceff'
  on-secondary-fixed: '#001e2e'
  on-secondary-fixed-variant: '#004c6e'
  tertiary-fixed: '#ffdcbf'
  tertiary-fixed-dim: '#ffb872'
  on-tertiary-fixed: '#2d1600'
  on-tertiary-fixed-variant: '#6a3b00'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display:
    fontFamily: Lexend
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Lexend
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Lexend
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
  headline-md:
    fontFamily: Lexend
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: Lexend
    fontSize: 19px
    fontWeight: '500'
    lineHeight: 28px
  body-md:
    fontFamily: Lexend
    fontSize: 17px
    fontWeight: '500'
    lineHeight: 24px
  label-lg:
    fontFamily: Lexend
    fontSize: 15px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Lexend
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
The brand personality is energetic, encouraging, and unapologetically fun. It is designed for learners and achievers who thrive in gamified environments. The visual style is a mix of **Tactile/Skeuomorphic** and **High-Contrast Bold**. 

The UI should feel like a physical toy—solid, clickable, and responsive. Every interaction is meant to provide a sense of accomplishment. We use "heavy" UI elements with thick borders and simulated 3D depth to make the digital experience feel tangible. The overall mood is optimistic, reducing the friction of difficult tasks through playful aesthetics.

## Colors
The palette is hyper-saturated and distinct. The primary green (#58cc02) drives action and progression. Each functional color has a corresponding "darker shade" (typically 15-20% darker) used for the bottom lip of 3D elements.

- **Primary (Green):** For main actions, success states, and progress.
- **Secondary (Blue):** For informational highlights and secondary CTAs.
- **Accent (Orange/Yellow):** For streaks, rewards, and high-energy alerts.
- **Error (Red):** For mistakes or critical warnings.
- **Neutral:** Pure white (#ffffff) for the main canvas, with light gray (#f7f7f7) used for background sections to create subtle contrast.

## Typography
We use **Lexend** across all levels for its exceptional readability and friendly, rounded character. 

Headlines should be set with tight tracking and heavy weights (Bold or ExtraBold) to feel impactful. Body text uses Medium weight to maintain the "chunky" visual language while ensuring legibility. Labels and buttons always use Bold or SemiBold weights to emphasize interactable areas.

## Layout & Spacing
The layout uses a **Fluid Grid** with generous white space to prevent the vibrant colors from becoming overwhelming. 

- **Desktop:** 12-column grid, max-width 1200px, centered.
- **Tablet:** 8-column grid, fluid margins.
- **Mobile:** 4-column grid, 16px side margins.

Spacing follows a 4px-base system. Vertical rhythm is relaxed, favoring large paddings inside containers (typically 24px or 32px) to give the bold typography room to breathe.

## Elevation & Depth
This design system rejects ambient shadows in favor of **Tonal 3D Lips** and **Bold Borders**. 

Depth is communicated through a 2-4px solid bottom border that is a darker shade of the element's background color. When a user interacts with a 3D element (like a button), the element should translate Y-down by 2px, and the bottom lip should shrink, simulating a physical press.

Cards and containers use a 2px solid border (#e5e5e5) instead of drop shadows to maintain a clean, illustrative look.

## Shapes
The shape language is extremely soft and approachable. 
- **Standard UI elements:** 12px to 16px corner radius.
- **Cards and Large Containers:** 20px to 24px corner radius.
- **Buttons:** Often use a fully rounded (pill) shape or a 16px radius.

All strokes on borders should be consistent—typically 2px for standard containers and buttons.

## Components

### Buttons
Buttons are the core of the experience. They feature a 4px "lip" (bottom border) in a darker shade. On `:active` states, the button shifts down, and the lip disappears. 
- **Primary:** Green background, Dark Green lip, White text.
- **Secondary:** Blue background, Dark Blue lip, White text.
- **Ghost:** White background, Light Gray border/lip, Blue or Gray text.

### Cards
Cards use a 2px solid border (#e5e5e5). They do not use shadows. Content inside cards should have a minimum of 24px padding.

### Progress Bars
Large, chunky bars with a 16px height. The container is a light gray (#e5e5e5), and the progress indicator is a vibrant color (Green or Orange) with a rounded cap.

### Input Fields
Inputs feature a 2px solid border. On focus, the border thickness remains the same but changes color to Feather Blue, and the bottom "lip" of the input deepens slightly.

### Chips & Tags
Small, rounded pills used for categories or selection. When selected, they take on the primary color and the 3D "pressed" look.

### Icons
Use thick-stroke, rounded icons. Avoid thin lines. Icons should feel as "weighty" as the typography.