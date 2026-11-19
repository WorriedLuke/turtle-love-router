
# Turtle Remote Shell

A lightweight remote Lua console for CC:Tweaked turtles.

## Architecture

- Cloudflare Worker: WebSocket endpoint and authentication
- Durable Object: WebSocket routing
- CC:Tweaked: Lua execution agent
- Python: Interactive remote console

## Cloudflare configuration

The Worker uses a SQLite-backed Durable Object.

Configuration is defined in wrangler.jsonc.

Required secrets:

- SERVER_TOKEN
- TURTLE_TOKEN

Set these in Cloudflare Dashboard:

Workers & Pages
-> Your Worker
-> Settings
-> Variables and Secrets

Add both as encrypted secrets.

## Deployment

Install dependencies:

    npm install

Deploy:

    npx wrangler deploy

For GitHub deployments, connect this repository to
Cloudflare Workers Builds and use:

    npm install && npx wrangler deploy

## Turtle setup

Edit turtle/remote.lua.

Configure:

- Worker URL
- Turtle ID
- Turtle token

Copy remote.lua to your turtle.

Run:

    remote

## Console setup

Install Python dependencies:

    pip install -r console/requirements.txt

Edit console/console.py.

Configure:

- Worker URL
- Server token
- Turtle ID

Run:

    python console/console.py

## Example commands

    turtle.getFuelLevel()

    turtle.forward()

    turtle.getItemCount(1)

    print("Hello from remote Lua!")

    return gps.locate()

## Security

The remote shell executes arbitrary Lua code on the turtle.

Only trusted operators should have access.

Never commit authentication tokens to GitHub.
