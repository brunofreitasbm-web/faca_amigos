Labeled text input with focus highlight and error state. Two themes matching app (dark) and web (light) surfaces.

```jsx
<Input label="Nome" placeholder="Como você se chama?" />
<Input label="Telefone" type="tel" placeholder="(11) 99999-9999" variant="dark" />
<Input label="E-mail" error="E-mail inválido" value={val} onChange={setVal} />
<Input disabled placeholder="Indisponível" />
```

Focus ring: pink glow. Error: red border + message below. Height always 48px.
