---
name: "<Product name>"
description: "<One sentence: what the product is and who it is for>"
colors:
  surface: "<hex>"
  text: "<hex>"
  primary: "<hex>"
  accent: "<hex>"
  muted: "<hex>"
  danger: "<hex>"
typography:
  display:
    fontFamily: "<family>"
    fontSize: "<rem>"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "<em>"
  heading:
    fontFamily: "<family>"
    fontSize: "<rem>"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "<family>"
    fontSize: "<rem>"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "<family>"
    fontSize: "<rem>"
    fontWeight: 500
    lineHeight: 1.3
  code:
    fontFamily: "<monospace family>"
    fontSize: "<rem>"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "<px>"
  md: "<px>"
  lg: "<px>"
spacing:
  unit: "<px>"
  sm: "<px>"
  md: "<px>"
  lg: "<px>"
  xl: "<px>"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
northstar:
  mode: "<operate | read | persuade | experience>"
  stack: "<react | next | vue | svelte | angular | solid | html>"
  libraries:
    components: "<for example shadcn/ui>"
    icons: "<for example lucide-react>"
    fonts: "<for example @fontsource-variable/family>"
  allow: []
  ignore: []
---

# <Product name> design system

## Overview

Describe the product, the audience and the chosen direction in a short paragraph. State the mood in three adjectives, the mode and the one bold choice this system protects. Explain why, not only what.

## Colors

Name each colour by role and say what it is for. Keep to 4 to 6 roles. Neutrals are tinted toward the palette hue. List the text and surface pairs that must pass contrast, for light and dark themes separately, for example text on surface and surface on primary.

## Typography

Describe each type role and when to use it. Name the families and where they come from, as chosen through the font resolver. Note the display size cap for the mode, the body measure and the number formats for data.

## Layout

Describe the grid, the base spacing unit, the density and how the layout changes from the narrowest width to desktop. Note where content is allowed to be asymmetric and where it must align.

## Elevation & Depth

Describe how depth is expressed: soft layered shadows, background steps or borders. State what never gets a shadow. Hard offset shadows are only used if the declared direction requires them.

## Shapes

Describe the radius scale and the shape language: where corners are sharp, where they are soft, and how icons match, including the stroke width and size used.

## Components

List the components in use, the library each comes from, and the states each must support: default, hover, focus, active, disabled, loading, error and empty where relevant. Note any component with project specific behaviour.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use tokens by reference | Write raw colour or spacing values in code |
| Take components, icons and fonts from the chosen libraries | Hand roll overlays, icons or font loading |
| Keep one bold choice per screen | Add competing accents |
| Provide a reduced motion path | Animate layout properties |
