The primary navigation metaphor in the FaçaAmigos mobile app. A solid-colored circle wrapped in a conic gradient ring (purple→pink→orange→yellow), on a dark background. Label appears below.

```jsx
<CircleButton color="#F05870" label="Horários" size={88} />
<CircleButton color="#2ECFB5" label="Dúvidas" size={88} />
<CircleButton color="#FFFFFF" label="Inclusão" size={88} />
<CircleButton color="#F0C030" label="Localização" size={88} />
```

The ring is always the brand gradient (--gradient-ring). The inner circle color changes per category.
Press: scale(0.93) with bounce easing.
Always sits on --color-bg-app (#141414) background.
