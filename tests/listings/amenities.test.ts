import { describe, expect, it } from "vitest";
import { detectAmenities } from "../../src/server/listings/normalize.js";

describe("detectAmenities", () => {
  it("armário na cozinha", () => {
    expect(detectAmenities("Apartamento com cozinha planejada e área de serviço")).toContain("armario_cozinha");
    expect(detectAmenities("Possui ARMÁRIOS NA COZINHA e no banheiro")).toContain("armario_cozinha");
    expect(detectAmenities("armários de cozinha novos")).toContain("armario_cozinha");
    expect(detectAmenities("Cozinha com armários")).toContain("armario_cozinha");
    expect(detectAmenities("Cozinha espaçosa, área de serviço")).not.toContain("armario_cozinha");
  });

  it("guarda-roupa no quarto", () => {
    expect(detectAmenities("Dormitório com guarda-roupa")).toContain("armario_quarto");
    expect(detectAmenities("guarda roupas embutido")).toContain("armario_quarto");
    expect(detectAmenities("Suíte com closet")).toContain("armario_quarto");
    expect(detectAmenities("armário embutido nos dois quartos")).toContain("armario_quarto");
    expect(detectAmenities("Armários planejados nos dormitórios")).toContain("armario_quarto");
    expect(detectAmenities("Quartos planejados")).toContain("armario_quarto");
    expect(detectAmenities("02 dormitórios, sendo 01 suíte")).not.toContain("armario_quarto");
  });

  it("pia / bancada e mobiliado", () => {
    expect(detectAmenities("Bancada de granito com cuba inox")).toContain("pia");
    expect(detectAmenities("Pia na cozinha")).toContain("pia");
    expect(detectAmenities("São 25m², mobiliado, aceita animais")).toEqual(["mobiliado"]);
    expect(detectAmenities("Semi-mobiliado")).toContain("mobiliado");
    expect(detectAmenities("Espiar a piada")).toEqual([]);
  });

  it("texto vazio e combinação", () => {
    expect(detectAmenities(undefined)).toEqual([]);
    expect(detectAmenities("Cozinha planejada com pia e bancada; guarda-roupa no quarto")).toEqual(["armario_cozinha", "armario_quarto", "pia"]);
  });
});
