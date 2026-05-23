import { Hono } from "hono";
import { successResponse } from "../util/response";

const mainRouter = new Hono();

mainRouter.get("/", (c) => c.json({ message: "Hello from main router!" }, 200));

mainRouter.get("/health", (c) => c.json(successResponse("OK", "Server is healthy!"), 200));

export default mainRouter;
