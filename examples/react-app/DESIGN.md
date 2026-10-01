---
name: Northwind plans
description: Design system for the in-app plans page of the Northwind analytics app.
colors:
  primary: "#1E40AF"
  on-primary: "#FFFFFF"
  accent: "#D97706"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  text: "#0F172A"
  muted: "#E9EEF6"
  border: "#DBEAFE"
  danger: "#DC2626"
typography:
  heading:
    fontFamily: Fira Sans
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: Fira Sans
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  numeral:
    fontFamily: Fira Code
    fontSize: 2.5rem
    fontWeight: 500
    lineHeight: 1.1
rounded:
  md: 8px
spacing:
  unit: 4px
northstar:
  mode: operate
  stack: react
  libraries:
    components: Radix Primitives
    icons: Lucide
    fonts: Fontsource
  allow: []
  ignore: []
---

# Northwind plans design system

## Overview

A calm, precise system for a signed in workspace owner who compares plans and upgrades. Operate mode: dense, scannable, no decoration. It is applied to the plans page first and migrates to the other pages later.

## Colors

- primary: #1E40AF, buttons, focus rings, the selected billing option
- on-primary: #FFFFFF
- accent: #D97706, only the Recommended marker
- background: #F8FAFC
- surface: #FFFFFF, plan columns and the comparison table
- text: #0F172A
- muted: #E9EEF6, table group rows and the switch track
- border: #DBEAFE
- danger: #DC2626

## Typography

- heading: Fira Sans 600
- body: Fira Sans 400
- numeral: Fira Code 500 with tabular figures, prices and comparison values only

## Layout

4px base unit. Three equal plan columns with a 16px gap, then a full width comparison table. Below 760px the columns stack and the table scrolls horizontally inside its own container with a sticky first column. The page never scrolls horizontally.

## Elevation & Depth

Depth comes from 1px borders and the surface against background contrast. Nothing gets a shadow.

## Shapes

One 8px radius for columns, buttons and the switch. Lucide icons at 16px with a 1.75 stroke.

## Components

- Billing switch: Radix ToggleGroup, states default, hover, focus visible, selected, disabled
- Plan column: plain section, states default and current plan, never nested in another card
- Plan button: primary for upgrade, secondary for downgrade, disabled for the current plan
- Comparison table: semantic table with grouped rows, Lucide Check and Minus with text for screen readers
- Tooltip: Radix Tooltip on terms like SSO and Audit log, opens on hover and focus

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use tokens by reference | Write raw colour or spacing values in code |
| Mark the current plan with text | Rely on colour alone to mark it |
| Keep prices in Fira Code tabular figures | Use the numeral face for headings |
| Announce price changes with aria-live | Change prices silently |
