import express from "express";
import {
  Login,
  Logout,
  ChangePassword,
  CheckSession,
} from "../controller/auth.controller.ts";
import requireAuth from "../middleware/Authentication.ts";

const routes = express.Router();

routes.post("/login", Login);

routes.post("/logout", Logout);

routes.post("/change-password", requireAuth, ChangePassword);

routes.get("/me", requireAuth, CheckSession);

export default routes;
