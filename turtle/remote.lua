
-- Turtle Remote Shell Agent
-- CC:Tweaked

local CONFIG = {
    turtleId = "turtle-01",
    url = "wss://YOUR-WORKER.workers.dev/ws/turtle/turtle-01",
    token = "YOUR_TURTLE_TOKEN",
    reconnectDelay = 5
}

local function pack(...)
    return {
        n = select("#", ...),
        ...
    }
end

local function stringify(value)
    local ok, result = pcall(textutils.serialize, value)

    if ok then
        return result
    end

    return tostring(value)
end

-- Persistent environment.
local output = {}

local remoteEnv = setmetatable({}, {
    __index = _ENV
})

-- Redirect remote print() to the console.
remoteEnv.print = function(...)
    local args = pack(...)

    local values = {}

    for i = 1, args.n do
        values[#values + 1] = tostring(args[i])
    end

    output[#output + 1] = table.concat(values, "\t")
end

remoteEnv.write = function(value)
    output[#output + 1] = tostring(value)
end

local function execute(code)
    output = {}

    -- First try as an expression.
    local fn = load(
        "return " .. code,
        "remote",
        "t",
        remoteEnv
    )

    -- Otherwise try as a statement.
    if not fn then
        fn = load(
            code,
            "remote",
            "t",
            remoteEnv
        )
    end

    if not fn then
        return false, "Unable to compile Lua code"
    end

    local result = pack(pcall(fn))

    if not result[1] then
        return false, tostring(result[2])
    end

    -- Include returned values.
    for i = 2, result.n do
        output[#output + 1] = stringify(result[i])
    end

    return true, table.concat(output, "\n")
end

local function send(ws, message)
    ws.send(textutils.serializeJSON(message))
end

local function handleMessage(ws, message)
    local ok, data = pcall(
        textutils.unserializeJSON,
        message
    )

    if not ok or type(data) ~= "table" then
        return
    end

    if data.type ~= "shell_request" then
        return
    end

    if type(data.code) ~= "string" then
        return
    end

    local success, result = execute(data.code)

    send(ws, {
        type = "shell_response",
        requestId = data.requestId,
        success = success,
        output = success and result or nil,
        error = success and nil or result
    })
end

local function connect()
    return http.websocket(
        CONFIG.url,
        {
            Authorization = "Bearer " .. CONFIG.token
        }
    )
end

print("Remote Shell Agent")
print("Turtle: " .. CONFIG.turtleId)

while true do
    print("Connecting...")

    local ws, err = connect()

    if ws then
        print("Connected to remote shell!")

        local connected = true

        while connected do
            local ok, message = pcall(function()
                return ws.receive()
            end)

            if not ok or message == nil then
                connected = false
                break
            end

            local handled, handleError = pcall(
                handleMessage,
                ws,
                message
            )

            if not handled then
                print("Agent error: " .. tostring(handleError))
            end
        end

        pcall(function()
            ws.close()
        end)

        print("Disconnected.")
    else
        print("Connection failed: " .. tostring(err))
    end

    print("Reconnecting in " .. CONFIG.reconnectDelay .. " seconds...")
    sleep(CONFIG.reconnectDelay)
end
