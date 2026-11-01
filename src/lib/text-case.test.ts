import { expect, it } from "vitest";
import { capitalizeWords } from "./text-case";

it("capitalises the first letter of each word", () => {
  expect(capitalizeWords("ravi kumar")).toBe("Ravi Kumar");
  expect(capitalizeWords("ring 2, studs 1")).toBe("Ring 2, Studs 1");
  expect(capitalizeWords("12a gandhi road,\nmadurai-625001")).toBe("12a Gandhi Road,\nMadurai-625001");
  expect(capitalizeWords("s.kumar (late)")).toBe("S.Kumar (Late)");
});

it("leaves the other letters as typed", () => {
  expect(capitalizeWords("KUMAR")).toBe("KUMAR");
  expect(capitalizeWords("mcDonald")).toBe("McDonald");
});

it("keeps spaces while typing, and leaves Tamil and empty text alone", () => {
  expect(capitalizeWords("ravi ")).toBe("Ravi ");
  expect(capitalizeWords("குமார் raja")).toBe("குமார் Raja");
  expect(capitalizeWords("")).toBe("");
});
