// Copyright (c) 2026 Rutej Talati. All rights reserved.
// AeroNet — neural surrogate model for vehicle aerodynamics.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Material 3 dark scheme — tonal surface system
        m3: {
          // Surfaces (dark)
          bg:          '#0f1416',
          surface:     '#141c1f',
          surface1:    '#1a2428',
          surface2:    '#1e2b30',
          surface3:    '#223035',
          surfaceVar:  '#1f282c',
          outline:     '#3a4f56',
          outlineVar:  '#243339',

          // Primary — cyan tonal
          primary:     '#4dd8e8',
          onPrimary:   '#003640',
          primaryCont: '#004f5e',
          onPrimCont:  '#9eedf8',

          // Secondary
          secondary:   '#7ecfdb',
          secCont:     '#1a3f47',
          onSecCont:   '#b2eaf3',

          // Tertiary
          tertiary:    '#93c8b0',
          tertCont:    '#1a4035',
          onTertCont:  '#b2e4cc',

          // Error
          error:       '#ffb4ab',
          errCont:     '#93000a',

          // On-colors
          onBg:        '#dde4e7',
          onSurface:   '#c4cbd0',
          onSurfVar:   '#a0b4bc',

          // CFD pressure ramp
          cpHigh:      '#ef4444',
          cpMid:       '#fbbf24',
          cpZero:      '#84cc16',
          cpLow:       '#22d3ee',
          cpMin:       '#4f46e5',

          ok:          '#4ade80',
          warn:        '#fbbf24',
          err:         '#f87171',
        },

        // iOS dark system colors (used by redesigned components)
        ios: {
          bg0:     '#000000',
          bg1:     '#1C1C1E',
          bg2:     '#2C2C2E',
          bg3:     '#3A3A3C',
          bg4:     '#48484A',
          label:   '#FFFFFF',
          label2:  'rgba(235,235,245,0.60)',
          label3:  'rgba(235,235,245,0.30)',
          sep:     'rgba(84,84,88,0.55)',
          blue:    '#0A84FF',
          green:   '#30D158',
          orange:  '#FF9F0A',
          red:     '#FF453A',
          indigo:  '#5E5CE6',
          teal:    '#40CBE0',
          yellow:  '#FFD60A',
        },
      },
      fontFamily: {
        sans:    ["'IBM Plex Sans'", '"Roboto Flex"', 'Roboto', 'ui-sans-serif', 'system-ui'],
        mono:    ["'IBM Plex Mono'", '"Roboto Mono"', 'ui-monospace', 'monospace'],
        display: ["'IBM Plex Sans'", '"Roboto Flex"', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        // M3 type scale
        'label-sm':    ['11px', { lineHeight: '16px', letterSpacing: '0.05em',  fontWeight: '500' }],
        'label-md':    ['12px', { lineHeight: '16px', letterSpacing: '0.05em',  fontWeight: '500' }],
        'label-lg':    ['14px', { lineHeight: '20px', letterSpacing: '0.01em',  fontWeight: '500' }],
        'body-sm':     ['12px', { lineHeight: '16px', letterSpacing: '0.04em'  }],
        'body-md':     ['14px', { lineHeight: '20px', letterSpacing: '0.025em' }],
        'body-lg':     ['16px', { lineHeight: '24px', letterSpacing: '0.015em' }],
        'title-sm':    ['14px', { lineHeight: '20px', letterSpacing: '0.01em',  fontWeight: '500' }],
        'title-md':    ['16px', { lineHeight: '24px', letterSpacing: '0.015em', fontWeight: '500' }],
        'title-lg':    ['22px', { lineHeight: '28px', fontWeight: '400' }],
        'headline-sm': ['24px', { lineHeight: '32px', fontWeight: '400' }],
        'headline-md': ['28px', { lineHeight: '36px', fontWeight: '400' }],
        'display-sm':  ['36px', { lineHeight: '44px', fontWeight: '400' }],
        'display-md':  ['45px', { lineHeight: '52px', fontWeight: '400' }],

        // iOS type scale
        't-largetitle': ['34px', { lineHeight: '1.1',  fontWeight: '700', letterSpacing: '-1px'   }],
        't-title1':     ['28px', { lineHeight: '1.2',  fontWeight: '700', letterSpacing: '-0.8px' }],
        't-title2':     ['22px', { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.5px' }],
        't-title3':     ['20px', { lineHeight: '1.3',  fontWeight: '600', letterSpacing: '-0.4px' }],
        't-headline':   ['17px', { lineHeight: '1.47', fontWeight: '600', letterSpacing: '-0.4px' }],
        't-body':       ['17px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '-0.24px'}],
        't-callout':    ['16px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '-0.24px'}],
        't-subhead':    ['15px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '-0.24px'}],
        't-footnote':   ['13px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '-0.08px'}],
        't-caption1':   ['12px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '-0.08px'}],
        't-caption2':   ['11px', { lineHeight: '1.47', fontWeight: '400', letterSpacing: '0'     }],
      },
      borderRadius: {
        // M3 shape scale
        'xs':   '4px',
        'sm':   '8px',
        'md':   '12px',
        'lg':   '16px',
        'xl':   '24px',
        'full': '9999px',
      },
      boxShadow: {
        // M3 elevation
        'elev1': '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15)',
        'elev2': '0 1px 2px rgba(0,0,0,0.3), 0 2px 6px 2px rgba(0,0,0,0.15)',
        'elev3': '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)',
        'elev4': '0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px rgba(0,0,0,0.3)',
        'elev5': '0 8px 12px 6px rgba(0,0,0,0.15), 0 4px 4px rgba(0,0,0,0.3)',
        'glow-primary': '0 0 20px rgba(77,216,232,0.25)',
        'glow-sm':      '0 0 8px rgba(77,216,232,0.2)',
      },
      animation: {
        'fade-in':    'fadeIn 300ms cubic-bezier(0.2,0,0,1)',
        'slide-up':   'slideUp 300ms cubic-bezier(0.2,0,0,1)',
        'slide-in':   'slideIn 250ms cubic-bezier(0.2,0,0,1)',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'scan':       'scan 2.5s ease-in-out infinite',
        'ripple':     'ripple 600ms linear',
        'spin-slow':  'spin 3s linear infinite',
        'anim-up':    'slideUp 0.4s cubic-bezier(0.22,1,0.36,1) both',
        'anim-in':    'fadeIn 0.25s ease both',
        'anim-scan':  'scan 2.4s ease-in-out infinite',
        'anim-pulse': 'pulse 2.5s ease-in-out infinite',
        'anim-spin':  'spin 0.9s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                                        to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' },         to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-8px)' },         to: { opacity: '1', transform: 'translateX(0)' } },
        scan: {
          '0%,100%': { transform: 'translateY(0%)',    opacity: '0.4' },
          '50%':     { transform: 'translateY(100%)',  opacity: '1'   },
        },
        ripple: {
          from: { transform: 'scale(0)', opacity: '0.4' },
          to:   { transform: 'scale(4)', opacity: '0'   },
        },
      },
      transitionTimingFunction: {
        'm3-standard':   'cubic-bezier(0.2,0,0,1)',
        'm3-decelerate': 'cubic-bezier(0,0,0,1)',
        'm3-accelerate': 'cubic-bezier(0.3,0,1,1)',
        'ios-spring':    'cubic-bezier(0.22,1,0.36,1)',
      },
    },
  },
  plugins: [],
}
