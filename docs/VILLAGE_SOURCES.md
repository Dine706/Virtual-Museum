# Village scenes in walk mode: sources and limits

Research for the villages around Mount Nimba (Bossou, Séringbara, Gbakoré, N'Zoo, Yéalé, Yekepa…) as shown in walk mode. Every visible element of a village scene follows this file. Anything not listed here is not shown.

Evidence levels:
* **A**: peer-reviewed paper, primary research project or census.
* **B**: encyclopedia or NGO guide.
* **C**: weak.

## Where the buildings are
Building footprints, roads, paths, land use and place names come from **OpenStreetMap** (© OpenStreetMap contributors, ODbL 1.0), fetched by `scripts/worldpack/fetch_osm.py`:
* 9,824 buildings;
* 2,578 roads and paths;
* 642 land-use areas;
* 42 named places.

The houses stand where OSM has them. Their shape and materials are typical of the region, not surveyed house by house.

## Houses
* **[B] Kpelle/Guerzé.** The traditional house is round, with wattle-and-daub walls and a conical thatched roof. It now "predominates only in relatively remote" villages. More common today are square or rectangular houses with porches. "Zinc roofs are gradually replacing thatch." https://www.everyculture.com/Africa-Middle-East/Kpelle-Settlements.html
* **[B] Rural Liberia.** Most newer houses are rectangular, roofed with corrugated zinc or tin. Wattle and daub is the usual construction. Villages have an open-sided "palaver hut". https://www.everyculture.com/Ja-Ma/Liberia.html
* **[B] Guinea.** Wealthier households build concrete houses with corrugated metal roofs. https://www.everyculture.com/Ge-It/Guinea.html
* **Yekepa** is a former mining company town (LAMCO), not a traditional village. https://en.wikipedia.org/wiki/Yekepa
* **Rendering rule (an inference from the above):**
  * Small square footprints (≤ 6.5 m, about square) → round wattle-and-daub hut with a thatched cone.
  * Other footprints → rectangular earth-plastered house with a corrugated metal roof, some rusty.

## Everyday activities shown
* **[A] Bossou.** Swidden farming, with upland rice, cassava, maize and banana. Yamakoshi & Leblan 2013, *Revue de primatologie* 5, https://journals.openedition.org/primatologie/1762
* **[A] Green Corridor.** Rice and cassava are staples. People and chimpanzees both rely on oil palms. The weekly market is on Wednesdays. https://www.greencorridor.info/en/people/
* **[B] Kpelle division of labour.** Men clear fields and gather palm nuts and palm wine; women plant, fish and gather; there are weekly markets. https://www.everyculture.com/Africa-Middle-East/Kpelle-Economy.html
* **[B] Guinea.** Children carry water and firewood and help prepare food. Mothers carry babies on their backs in a wrapper. https://www.everyculture.com/Ge-It/Guinea.html
* **[B] Palm oil in Forest Guinea** (Gret practical guide): bunches are boiled, the fruit is pounded in mortars, then kneaded and skimmed. https://gret.org/wp-content/uploads/2021/12/Guide-Pratique-Huile-de-Palme.pdf
* **Activities used:**
  * pounding in a mortar (palm fruit / food);
  * carrying a load or water;
  * carrying firewood (child);
  * a mother with a baby on her back;
  * hoeing in a field (rice or cassava);
  * walking along paths;
  * sitting and talking in the shade.
* Children playing appear without a specific source (generic everyday life). This is flagged here.

## Clothing
There is no Nimba-specific source:
* **[B]** Liberia: the "lappa" is two pieces of cloth.
* **[B]** Guinea: weavers and dyers sell cloth, and tailors make clothes.

Villagers wear generic everyday clothes: wrappers, shirts and trousers. **No masks, ceremonial or society costumes.**

## Never shown
* **Mt Gban, the sacred forest of Bossou's village spirit.** It is where ceremonies such as circumcision take place, and villagers do not enter it.
* **The Poro / Sande societies.**
* **Worship on Mt Nimba.**
* **The sacred catfish pond.**
* **Any rite.**

  Sources: Yamakoshi & Leblan 2013; greencorridor.info; https://en.wikipedia.org/wiki/Mano_people
* **Chimpanzees are not shown near people** and not as tame. Many villagers are afraid of them, and in 2024 the research centre was ransacked after a child's death (https://en.wikipedia.org/wiki/Bossou).
* **No real individual's likeness.** All villagers are generic, fictional figures, and the card says so.

## Population (for cards)
* **[A] Bossou village:** about 2,000 people (Yamakoshi & Leblan; greencorridor).
* **Bossou sub-prefecture:** 13,018 (RGPH-4, 2025). Do not confuse it with the village.

## Problem found in passing
The papfor.org PDFs cited in `public/data/content.json` for the `yeale` and `yekepa-lamco` hotspots now resolve to a parked domain. They need replacing or archive links (flagged here, not changed).
