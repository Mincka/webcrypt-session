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
  flag: z.string(),
  rounds: z.array(z.tuple([z.number(), z.string()])),
  sessionPassword: z.string(),
});

const signInParamScheme = z.object({
  username: z.string(),
});

const guessParamScheme = z.object({
  guess: z.string(),
});

const welComePage = `<!DOCTYPE html>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Please sign in first with <a href="/signIn">sign-in</a>.</p>
</body>
</html>`;

const welComeUserPage = `<!DOCTYPE html>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Welcome, <%= username %>.</p>
  <form action="guess" method="POST">
  <p>Guess the passcode!</p>
  <label>Passcode: <input type="text" name="guess" required autofocus <%= disabled %> /></label>
  <button type="submit" <%= disabled %> >Submit</button>
  </form>
  <p><%= hint %></p>
  <p>You can sign out by clicking on the following button.</p>
  <form action="signOut" method="POST">
  <button type="submit">Sign Out</button>
  </form>
</body>
</html>`;

const wonPage = `<!DOCTYPE html>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Welcome, <%= username %>.</p>
  <p>Incredible! You found your this session flag: '<b><%= flag %></b>'. You almost won!</p>
  <p>Crack the sessionPassword and share it with us as the final flag.</p>
  <p>You will have to find the last 3 characters: <%= sessionPassword %></p>
  <p>You can sign out by clicking on the following button.</p>
  <form action="signOut" method="POST">
  <button type="submit">Sign Out</button>
  </form>
</body>
</html>`;

const signInPage = `<!DOCTYPE html>
<body>
  <h1>Serverless Guessing Game</h1>
  <h2>Sign-in</h2>
  <form action="signIn" method="POST">
    <label>Username: <input type="text" name="username" required autofocus /></label>
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

// dec2charset :: Integer -> String
function dec2charset(dec: number) {
  const charset = "0123456789abcdefghijklmnopqrstuvwxyz";
  return charset[(dec % charset.length)];
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const sessionPassword = env.SESSION_PASSWORD;
    const webCryptSession = await createWebCryptSession(
      sessionScheme,
      request,
      {
        password: sessionPassword,
      }
    );
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    // https://stackoverflow.com/a/27747377/3049282
    // This function is required to be in the fetch by CF Workers
    // generateId :: Integer -> String
    function generateId(len: number) {
      const arr = new Uint8Array(len)
      crypto.getRandomValues(arr)
      return Array.from(arr, dec2charset).join('')
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

        const flag = generateId(flagLength);
        const shuffledRounds = generatePlaySequence(flag);

        console.log(flag);
        console.log(sessionPassword);
        // shuffledRounds.forEach(function (value, i)
        // {
        //  console.log( value[0] + " " + value[1]); 
        // });

        await webCryptSession.save({
          username: signInParam.username,
          flag: flag,
          rounds: shuffledRounds,
          sessionPassword: sessionPassword
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
    } else if (url.pathname === "/guess") {
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
        const guessParam = guessParamScheme.parse(formObject);
        
        if(guessParam.guess == webCryptSession.flag)
        {
          const partialSessionPassword = webCryptSession.sessionPassword.slice(0, -3).concat("***");
          return new Response(
            wonPage.replace("<%= username %>", webCryptSession.username)
            .replace("<%= flag %>", webCryptSession.flag)
            .replace("<%= sessionPassword %>", partialSessionPassword),
            {
              headers: {
                "Set-Cookie": webCryptSession.toHeaderValue() ?? "",
                "content-type": "text/html;charset=UTF-8",
              },
            }
          );
        }
        
        let hint;
        let disabled = "";
        if(webCryptSession.rounds.length  == 0)
        {
          hint = "Game over";
          disabled = "disabled";
        }
        else
        {
          hint = "Hint: There is no '" + webCryptSession.rounds[0][1] + "' at position '" + webCryptSession.rounds[0][0] + "'";
        }
    
        if(webCryptSession.rounds.length  > 0)
        {
          webCryptSession.rounds.shift();
        }
        
        await webCryptSession.save({
          username: webCryptSession.username,
          flag: webCryptSession.flag,
          rounds: webCryptSession.rounds,
          sessionPassword: webCryptSession.sessionPassword
        });

        return new Response(
          welComeUserPage.replace("<%= username %>", webCryptSession.username)
          .replace("<%= hint %>", hint)
          .replaceAll("<%= disabled %>", disabled),
          {
            headers: {
              "Set-Cookie": webCryptSession.toHeaderValue() ?? "",
              "content-type": "text/html;charset=UTF-8",
            },
          }
        );
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
      welComeUserPage.replace("<%= username %>", webCryptSession.username)
      .replace("<%= hint %>", "I may try to help if it's too hard for you...")
      .replaceAll("<%= disabled %>", ""),
      {
        headers: {
          "Set-Cookie": webCryptSession.toHeaderValue() ?? "",
          "content-type": "text/html;charset=UTF-8",
        },
      }
    );
  },
};
