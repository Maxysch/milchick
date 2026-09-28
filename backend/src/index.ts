// Arranca el servidor. La app en sí vive en `app.ts` para que se pueda montar
// sin escuchar un puerto —tests, o un host serverless que la invoca por
// request— y para que este archivo tenga una sola responsabilidad.
import app from './app.js';

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Milchick backend running on port ${PORT}`);
});
