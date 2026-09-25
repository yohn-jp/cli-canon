import test from "node:test";
import { certifyComposition } from "./composition-certification.mjs";

test("public source build certifies thin canonical and composed consumers", certifyComposition);
