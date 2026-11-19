
import asyncio
import json
import uuid

import websockets


CONFIG = {
    "url": "wss://YOUR-WORKER.workers.dev/ws/server",
    "token": "YOUR_SERVER_TOKEN",
    "turtle_id": "turtle-01",
    "timeout": 60
}


async def main():
    pending = {}

    async with websockets.connect(
        CONFIG["url"],
        additional_headers={
            "Authorization": f"Bearer {CONFIG['token']}"
        }
    ) as ws:

        print("Connected to Turtle Router")
        print(f"Target: {CONFIG['turtle_id']}")
        print("Type 'exit' to quit.\n")

        async def receiver():
            while True:
                raw = await ws.recv()
                message = json.loads(raw)

                msg_type = message.get("type")

                if msg_type == "connected":
                    turtles = message.get("turtles", [])
                    print(f"Connected turtles: {turtles}")
                    continue

                if msg_type == "turtle_connected":
                    print(
                        f"\n[+] Turtle connected: "
                        f"{message.get('turtleId')}"
                    )
                    continue

                if msg_type == "turtle_disconnected":
                    print(
                        f"\n[-] Turtle disconnected: "
                        f"{message.get('turtleId')}"
                    )
                    continue

                if msg_type == "shell_response":
                    payload = message.get("payload", {})
                    request_id = payload.get("requestId")

                    future = pending.pop(request_id, None)

                    if future and not future.done():
                        future.set_result(payload)

                    continue

                if msg_type == "shell_error":
                    request_id = message.get("requestId")
                    future = pending.pop(request_id, None)

                    if future and not future.done():
                        future.set_exception(
                            RuntimeError(message.get("message", "Unknown error"))
                        )
                    else:
                        print(
                            f"\n[Router error] "
                            f"{message.get('message')}"
                        )

        receiver_task = asyncio.create_task(receiver())

        try:
            while True:
                try:
                    code = await asyncio.to_thread(
                        input,
                        f"{CONFIG['turtle_id']}> "
                    )
                except EOFError:
                    break

                if code.strip() in ("exit", "quit"):
                    break

                if not code.strip():
                    continue

                request_id = str(uuid.uuid4())
                future = asyncio.get_running_loop().create_future()
                pending[request_id] = future

                await ws.send(json.dumps({
                    "type": "shell_request",
                    "turtleId": CONFIG["turtle_id"],
                    "requestId": request_id,
                    "code": code
                }))

                try:
                    response = await asyncio.wait_for(
                        future,
                        timeout=CONFIG["timeout"]
                    )

                    if response.get("success"):
                        output = response.get("output", "")

                        if output:
                            print(output)
                        else:
                            print("(no output)")
                    else:
                        print(f"Lua error: {response.get('error')}")

                except asyncio.TimeoutError:
                    print("Request timed out.")

                except RuntimeError as error:
                    print(f"Router error: {error}")

                finally:
                    pending.pop(request_id, None)

        finally:
            receiver_task.cancel()
            await asyncio.gather(
                receiver_task,
                return_exceptions=True
            )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nDisconnected.")
