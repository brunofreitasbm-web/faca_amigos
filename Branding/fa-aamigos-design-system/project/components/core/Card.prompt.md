Content container with rounded corners (24px), optional top image. Two themes: dark (app) and light (web).

```jsx
<Card variant="dark" title="Piscina de Bolinhas" subtitle="Para crianças de 2–10 anos">
  <Button size="sm">Ver mais</Button>
</Card>

<Card variant="light" imageSrc="/photo.jpg" title="Área de Escalada" subtitle="Supervisionada por monitores" onClick={() => {}} />
```

Hover: slight lift (translateY -2px) + shadow increase.
Never use sharp corners. No border-only style.
