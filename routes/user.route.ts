import express from "express";
import {
  createUser,
  deleteUser,
  updateUser,
  GetUsersByRole,
} from "../controller/user.controller.ts";
import requireAuth from "../middleware/Authentication.ts";

const routes = express.Router();

routes.post("/create", requireAuth, createUser);

routes.patch("/update", requireAuth, updateUser);

routes.delete("/delete/:userId", requireAuth, deleteUser);

routes.get("/users-by-role", requireAuth, GetUsersByRole);

export default routes;
