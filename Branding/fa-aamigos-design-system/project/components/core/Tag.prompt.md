Filter chip / category tag on dark backgrounds. Shows a colored accent dot. Optional remove button.

```jsx
<Tag>Piscina de Bolinhas</Tag>
<Tag color="var(--color-pink)">Festa</Tag>
<Tag color="var(--color-amber)" onRemove={() => removeFilter('kids')}>Crianças</Tag>
```

Always on dark bg. Dot color defaults to teal.
