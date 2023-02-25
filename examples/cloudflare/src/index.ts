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
  password: z.string(),
  rounds: z.array(z.tuple([z.number(), z.string()])),
  step1_sucess: z.boolean(),
  step2_sucess: z.boolean(),
  sessionPassword: z.string(),
  startTimestamp: z.number(),
  lastGuessTimestamp: z.number()
});

const signInParamScheme = z.object({
  username: z.string(),
});

const passwordParamScheme = z.object({
  password: z.string(),
});

const saltedSessionPasswordParamScheme = z.object({
  saltedSessionPassword: z.string(),
});

const welComePage = `<!DOCTYPE html>
<head><title>Serverless Guessing Game</title></head>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Please sign in first with <a href="/signIn">sign-in</a>.</p>
</body>
</html>`;

const welComeUserPage = `<!DOCTYPE html>
<head><title>Serverless Guessing Game</title></head>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Welcome, <%= username %>.</p>
  <h3>Step 1 - Guess the password!</h3>
  <form action="password_submit" method="POST">
  <label>Password: <input type="text" name="password" required autofocus <%= disabled %> /></label>
  <button type="submit" <%= disabled %> >Submit</button>
  </form>
  <p><%= hint %></p>
  <p>You have <%= remainingTime %> left.</p>
  <p>You can sign out by clicking on the following button.</p>
  <form action="signOut" method="POST">
  <button type="submit">Sign Out</button>
  </form>
</body>
</html>`;

const step1 = `<!DOCTYPE html>
<head><title>Serverless Guessing Game</title></head>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Incredible, <%= username %>! You've found the password! It was '<b><%= password %></b>'.</p>
  <h3>Step 2 - Crack the encryption of your session.</h3>
  <p>You will have to find the last 3 characters of the session password: <%= sessionPassword %><span style="color:red">***</span></p>
  <p>Submit <b>md5(<%= username %> + <%= password %> + <%= sessionPassword %><span style="color:red">***</span>)</b></p>
  <form action="flag_submit" method="POST">
  <label><input type="text" name="saltedSessionPassword" required autofocus <%= disabled %> /></label>
  <button type="submit" <%= disabled %> >Submit</button>
  </form>
  <p><%= hint %></p>
  <p>You have <%= remainingTime %> left.</p>
  <p>You can sign out by clicking on the following button.</p>
  <form action="signOut" method="POST">
  <button type="submit">Sign Out</button>
  </form>
</body>
</html>`;

const signInPage = `<!DOCTYPE html>
<head><title>Serverless Guessing Game</title></head>
<body>
  <h1>Serverless Guessing Game</h1>
  <h2>Sign-in</h2>
  <form action="signIn" method="POST">
    <label>Username: <input type="text" name="username" required autofocus /></label>
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;

const flag = `<!DOCTYPE html>
<head><title>Serverless Guessing Game</title></head>
<body>
  <h1>Serverless Guessing Game</h1>
  <p>Congratulations, <%= username %>! Please share with us the flag of this challenge and your write-up.</p>
  <h2><%= flag %></h2>
</body>
</html>`;

const minPasswordLength = 4;
const maxPasswordLength = 6;
const charset = "1jsnc9fo7gmtdxwpuh2y5k3v6b80raqezil4";
const minTimeBetweenGuesses = 250;
const maxGameDuration = 120 * 1000;

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

const generatePlaySequence = function (password: string): Array<typeof round> {
  const playground: Array<string> = [];

  for (let i = 0; i < password.length; i++) {
    playground[i] = charset.replace(password[i], '');
  }

  const roundCount = (26 + 10 - 1) * password.length;
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
  return charset[(dec % charset.length)];
}

function generateHintPhrase(position: number, character: string): string {

  switch (Math.random() * 2 | 0) {
    case 0:
      return "Nope, that's not the password. Hint: There is no '" + character + "' at position '" + position + "'.";
    default:
      return "Nope, that's not the password. Hint: At position '" + position + "', there is no '" + character + "'.";
  }

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

    const remainingTimeSeconds = Math.round((webCryptSession.startTimestamp + maxGameDuration - Date.now()) / 1000);

    let remainingTime = "no time";
    if (remainingTimeSeconds > 0) {
      remainingTime = remainingTimeSeconds + " seconds"
    }

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
        const passwordLength = randomIntFromInterval(minPasswordLength, maxPasswordLength);
        const password = generateId(passwordLength);
        const shuffledRounds = generatePlaySequence(password);

        console.log(password);
        //console.log(shuffledRounds.length)

        await webCryptSession.save({
          username: signInParam.username,
          password: password,
          rounds: shuffledRounds,
          step1_sucess: false,
          step2_sucess: false,
          sessionPassword: sessionPassword,
          startTimestamp: Date.now(),
          lastGuessTimestamp: Date.now()
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
    } else if (url.pathname === "/password_submit") {
      if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }

      if (Date.now() - webCryptSession.lastGuessTimestamp < minTimeBetweenGuesses) {
        return new Response("Too fast! Keep cool, you'll have just enough time to solve this.", { status: 429 });
      }

      try {
        const formData = await request.formData();
        const formObject = Object.fromEntries(formData.entries());
        const passwordParam = passwordParamScheme.parse(formObject);
        let validConditions = true;

        let hint;
        let disabled = "";
        if (webCryptSession.rounds.length == 0) {
          hint = "Game over, too many tries.";
          disabled = "disabled";
          validConditions = false;
        }
        else if (Date.now() - webCryptSession.startTimestamp > maxGameDuration) {
          hint = "Game over, too slow to guess.";
          disabled = "disabled";
          validConditions = false;
        }
        else {
          hint = generateHintPhrase(webCryptSession.rounds[0][0], webCryptSession.rounds[0][1]);
        }

       // Step 1 - Success
        if (passwordParam.password == webCryptSession.password && validConditions) {
          await webCryptSession.save({
            username: webCryptSession.username,
            password: webCryptSession.password,
            rounds: webCryptSession.rounds,
            step1_sucess: true,
            step2_sucess: false,
            sessionPassword: webCryptSession.sessionPassword,
            startTimestamp: webCryptSession.startTimestamp,
            lastGuessTimestamp: Date.now()
          });
          return new Response(null, {
            status: 303,
            headers: {
              location: "step1",
              "Set-Cookie": webCryptSession.toHeaderValue() ?? ""
            },
          });
        }

        if (webCryptSession.rounds.length > 0) {
          webCryptSession.rounds.shift();
        }

        await webCryptSession.save({
          username: webCryptSession.username,
          password: webCryptSession.password,
          rounds: webCryptSession.rounds,
          step1_sucess: false,
          step2_sucess: false,
          sessionPassword: webCryptSession.sessionPassword,
          startTimestamp: webCryptSession.startTimestamp,
          lastGuessTimestamp: Date.now()
        });
        return new Response(
          welComeUserPage.replace("<%= username %>", webCryptSession.username)
            .replace("<%= hint %>", hint)
            .replace("<%= remainingTime %>", remainingTime.toString())
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
    } else if (url.pathname === "/step1") {

      if(!webCryptSession.step1_sucess)
      {
        return new Response(null, {
          status: 303,
          headers: {
            location: baseUrl,
              "Set-Cookie": "session=delete; expires=Thu, 01 Jan 1970 00:00:00 GMT",
            },
          }
        );
      }
      let hint = "Think fast, time is running out...";
      let disabled = "";
      if (webCryptSession.rounds.length == 0) {
        hint = "Game over, too many tries.";
        disabled = "disabled";
      }
      else if (Date.now() - webCryptSession.startTimestamp > maxGameDuration) {
        hint = "Game over, too slow to guess.";
        disabled = "disabled";
      }

      const partialSessionPassword = webCryptSession.sessionPassword.slice(0, -3);
      return new Response(
        step1.replaceAll("<%= username %>", webCryptSession.username)
          .replaceAll("<%= password %>", webCryptSession.password)
          .replace("<%= remainingTime %>", remainingTime.toString())
          .replace("<%= hint %>", hint)
          .replaceAll("<%= disabled %>", disabled)
          .replaceAll("<%= sessionPassword %>", partialSessionPassword)
        ,
        {
          headers: {
            "content-type": "text/html;charset=UTF-8",
          },
        }
      );
    } else if (url.pathname === "/flag_submit") {

      if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }

      if(!webCryptSession.step1_sucess)
      {
        return new Response(null, {
          status: 303,
          headers: {
            location: baseUrl,
              "Set-Cookie": "session=delete; expires=Thu, 01 Jan 1970 00:00:00 GMT",
            },
          }
        );
      }

      if (Date.now() - webCryptSession.lastGuessTimestamp < minTimeBetweenGuesses) {
        return new Response("Too fast! Keep cool, you'll have just enough time to solve this.", { status: 429 });
      }

      let validStep2Conditions = true;
      if (Date.now() - webCryptSession.startTimestamp > maxGameDuration) {
        validStep2Conditions = false;
      }

      try {
        const formData = await request.formData();
        const formObject = Object.fromEntries(formData.entries());
        const saltedSessionPasswordParam = saltedSessionPasswordParamScheme.parse(formObject);
        
        // https://stackoverflow.com/a/64795218/3049282

        const msgUint8 = new TextEncoder().encode(webCryptSession.username + webCryptSession.password + webCryptSession.sessionPassword) // encode as (utf-8) Uint8Array
        const hashBuffer = await crypto.subtle.digest('MD5', msgUint8) // hash the message
        const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
        const saltedSessionPassword = hashArray.map(b => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string

        console.log(webCryptSession.username + webCryptSession.password + webCryptSession.sessionPassword);
        console.log(saltedSessionPassword);
        
        // Step 2 success
        if(saltedSessionPasswordParam.saltedSessionPassword == saltedSessionPassword  && validStep2Conditions)
        {
             await webCryptSession.save({
              username: webCryptSession.username,
              password: webCryptSession.password,
              rounds: webCryptSession.rounds,
              step1_sucess: true,
              step2_sucess: true,
              sessionPassword: webCryptSession.sessionPassword,
              startTimestamp: webCryptSession.startTimestamp,
              lastGuessTimestamp: Date.now()
            });
            return new Response(null, {
              status: 303,
              headers: {
                location: "flag",
                "Set-Cookie": webCryptSession.toHeaderValue() ?? ""
              },
            });
          }
        else
        {
          await webCryptSession.save({
            username: webCryptSession.username,
            password: webCryptSession.password,
            rounds: webCryptSession.rounds,
            step1_sucess: true,
            step2_sucess: false,
            sessionPassword: webCryptSession.sessionPassword,
            startTimestamp: webCryptSession.startTimestamp,
            lastGuessTimestamp: Date.now()
          });
          return new Response(null, {
            status: 303,
            headers: {
              location: "step1",
              "Set-Cookie": webCryptSession.toHeaderValue() ?? ""
            },
          });
        }

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
    } else if (url.pathname === "/flag") {
      if (request.method === "GET") {

        let validConditions = true;
        if (Date.now() - webCryptSession.startTimestamp > maxGameDuration) {
          validConditions = false;
        }

        if(webCryptSession.step1_sucess == true && webCryptSession.step2_sucess == true && validConditions) 
        {
          return new Response(flag
            .replace("<%= username %>", webCryptSession.username)
            .replace("<%= flag %>", env.FLAG), {
            headers: {
              "content-type": "text/html;charset=UTF-8",
            },
          });
        }
        else
        {
          return new Response(null, {
            status: 303,
            headers: {
              location: baseUrl,
                "Set-Cookie": "session=delete; expires=Thu, 01 Jan 1970 00:00:00 GMT",
              },
            }
          );
        }

      } else if (request.method !== "POST") {
        return new Response(null, { status: 405 });
      }
    }
    const session = webCryptSession.username;
    if (session == null) {
      return new Response(welComePage, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "Set-Cookie": "session=delete; expires=Thu, 01 Jan 1970 00:00:00 GMT",
        },
      });
    }

    return new Response(
      welComeUserPage.replace("<%= username %>", webCryptSession.username)
        .replace("<%= hint %>", "I may try to help if it's too hard for you...")
        .replace("<%= remainingTime %>", remainingTime.toString())
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
