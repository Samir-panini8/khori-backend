import express from "express";
import {
  Login,
  Logout,
  ChangePassword,
} from "../controller/auth.controller.ts";
import requireAuth from "../middleware/Authentication.ts";

const routes = express.Router();

routes.post("/login", Login);

routes.post("/logout", Logout);

routes.post("change-password", requireAuth, ChangePassword);

export default routes;
