/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { z } from "zod";
import { createWebCryptSession } from "webcrypt-session";
export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
}

// Declare a tuple type
let round: [number, string];


const sessionScheme = z.object({
  username: z.string(),
  rounds: z.array(z.tuple([z.number(), z.string()])),
});

const signInParamScheme = z.object({
  username: z.string(),
});

const welComePage = `<!DOCTYPE html>
<body>
  <h1>Hello WebCrypt-Session</h1>
  <p>Please sign in first with <a href="/signIn">sign-in</a>.</p>
</body>
</html>`;

const welComeUserPage = `<!DOCTYPE html>
<body>
  <h1>Hello WebCrypt-Session</h1>
  <p>Welcome, <%= username %>!</p>
  <p>You can sign out with clicking following button.</p>
  <form action="/signOut" method="POST">
  <button type="submit">Sign Out</button>
  </form>
</body>
</html>`;

const signInPage = `<!DOCTYPE html>
<body>
  <h1>Sign-In to WebCrypt-Session</h1>
  <form action="signIn" method="POST">
    <label>Username: <input type="text" name="username" required /></label>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;

const flagLength = 6;


// https://stackoverflow.com/a/7228322/3049282
const randomIntFromInterval = function (min: number, max: number) { // min and max included 
  return Math.floor(Math.random() * (max - min + 1) + min)
}

// https://sebhastian.com/fisher-yates-shuffle-javascript/
const fyShuffle = function (arr: Array<typeof round>) {
  let i = arr.length;
  while (--i > 0) {
    const randIndex = Math.floor(Math.random() * (i + 1));
    [arr[randIndex], arr[i]] = [arr[i], arr[randIndex]];
  }
  return arr;
}

const generatePlaySequence = function (flag: string): Array<typeof round> {
  const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
  const playground: Array<string> = [];
  console.log(flag);
  for (let i = 0; i < flag.length; i++) {
    playground[i] = charset.replace(flag[i], '');
  }

  const roundCount = (26 + 10 - 1) * flag.length;
  const rounds: Array<typeof round> = [];

  let roundPosition = 0;
  for (let i = 0; i < playground.length; i++) {
    for (let j = 0; j < (26 + 10 - 1); j++) {

      rounds[roundPosition] = round = [i, playground[i][j]];
      roundPosition++;
    }
  }

  const shuffleRounds = fyShuffle(rounds);

  return shuffleRounds;
}

// dec2hex :: Integer -> String
// i.e. 0-255 -> '00'-'ff'
function dec2hex(dec: number) {
  return dec.toString(16).padStart(2, "0")
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const webCryptSession = await createWebCryptSession(
      sessionScheme,
      request,
      {
        password: "IF4B#t69!WlX$uS22blaxDvzJJ%$vEh%",
      }
    );
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    // https://stackoverflow.com/a/27747377/3049282
    // This function is required to be in the fetch by CF Workers
    // generateId :: Integer -> String
    function generateId(len: number) {
      const arr = new Uint8Array((len || 40) / 2)
      crypto.getRandomValues(arr)
      return Array.from(arr, dec2hex).join('')
    }

    if (url.pathname === "/signIn") {
      if (request.method === "GET") {
        return new Response(signInPage, {
          headers: {
            "content-type": "text/html;charset=UTF-8",
          },
        });
      } else if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      try {
        const formData = await request.formData();
        const formObject = Object.fromEntries(formData.entries());
        const signInParam = signInParamScheme.parse(formObject);


        const shuffledRounds = generatePlaySequence(generateId(flagLength));

        // shuffledRounds.forEach(function (value, i)
        // {
        //  console.log( value[0] + " " + value[1]); 
        // });


        await webCryptSession.save({
          username: signInParam.username,
          rounds: shuffledRounds,
        });
        const session = webCryptSession.toHeaderValue();
        if (session == null) {
          throw new Error();
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: baseUrl,
            "Set-Cookie": session,
          },
        });
      } catch (_) {
        return new Response(null, {
          status: 400,
        });
      }
    } else if (url.pathname === "/signOut") {
      return new Response(null, {
        status: 303,
        headers: {
          location: baseUrl,
          "Set-Cookie": "session=delete; expires=Thu, 01 Jan 1970 00:00:00 GMT",
        },
      });
    }
    const session = webCryptSession.username;
    if (session == null) {
      return new Response(welComePage, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
        },
      });
    }
    return new Response(
      welComeUserPage.replace("<%= username %>", webCryptSession.username),
      {
        headers: {
          "Set-Cookie": webCryptSession.toHeaderValue() ?? "",
          "content-type": "text/html;charset=UTF-8",
        },
      }
    );
  },
};
