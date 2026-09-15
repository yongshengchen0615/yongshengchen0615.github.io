import { assertEquals } from "jsr:@std/assert@1";
import { selectLatestPointOffers } from "./latest-available-offers.ts";

Deno.test("selectLatestPointOffers uses current reward/template definitions and hides historical duplicates", () => {
  const offers = selectLatestPointOffers(
    [
      { id:"reward-a1",point_card_id:"card-1",threshold_stamps:5,ticket_template_id:"template-a1" },
      { id:"reward-a2",point_card_id:"card-1",threshold_stamps:10,ticket_template_id:"template-a2" },
    ],
    [
      { id:"card-1",title:"腳底集點卡",status:"active",expiry_mode:"unlimited",expires_on:null,sort_order:0 },
    ],
    [
      { id:"template-a1",title:"最新優惠 A1",status:"active" },
      { id:"template-a2",title:"最新優惠 A2",status:"active" },
    ],
    [
      { reward_id:null,point_card_id:"card-1",ticket_template_id:"template-a1",threshold_stamps:5,ticket_title:"舊優惠名稱" },
      { reward_id:"reward-a1",point_card_id:"card-1",ticket_template_id:"template-a1",threshold_stamps:5,ticket_title:"另一個舊名稱" },
      { reward_id:null,point_card_id:"card-1",ticket_template_id:"template-a2",threshold_stamps:5,ticket_title:"過期門檻版本" },
      { reward_id:"reward-a2",point_card_id:"card-1",ticket_template_id:"template-a2",threshold_stamps:10,ticket_title:"舊 A2 名稱" },
    ],
    "2026-09-15",
  );

  assertEquals(offers.map((offer) => ({
    title:offer.ticketTitle,
    threshold:offer.thresholdStamps,
  })), [
    { title:"最新優惠 A1",threshold:5 },
    { title:"最新優惠 A2",threshold:10 },
  ]);
});

Deno.test("selectLatestPointOffers ignores deleted or inactive current definitions", () => {
  const offers = selectLatestPointOffers(
    [
      { id:"reward-1",point_card_id:"card-1",threshold_stamps:5,ticket_template_id:"template-1" },
      { id:"reward-2",point_card_id:"card-2",threshold_stamps:10,ticket_template_id:"template-2" },
    ],
    [
      { id:"card-1",title:"停用卡",status:"inactive",expiry_mode:"unlimited",sort_order:0 },
      { id:"card-2",title:"有效卡",status:"active",expiry_mode:"unlimited",sort_order:1 },
    ],
    [
      { id:"template-1",title:"優惠一",status:"active" },
      { id:"template-2",title:"已停用優惠",status:"inactive" },
    ],
    [
      { reward_id:"reward-1",point_card_id:"card-1",ticket_template_id:"template-1",threshold_stamps:5 },
      { reward_id:"reward-2",point_card_id:"card-2",ticket_template_id:"template-2",threshold_stamps:10 },
    ],
    "2026-09-15",
  );
  assertEquals(offers, []);
});
