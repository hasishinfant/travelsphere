// 360° equirectangular panoramas for the destination viewer.
// Every image was checked by eye to show the named place, is openly licensed on Wikimedia Commons,
// and is served at Wikimedia's standard 3840/1920 px sizes with CORS enabled. Attribution is shown in the viewer
// as the licences require. Bali has no verified panorama yet, so it has no entry.

export interface Panorama {
  caption: string;
  image: string;       // 3840 px — Wikimedia standard thumbnail size
  imageSmall: string;  // 1920 px — phones / low-memory GPUs
  author: string;
  license: string;
  source: string;
}

export const PANORAMAS: Record<string, Panorama> = {
  'paris': {
    caption: "Eiffel Tower from Pont de Bir-Hakeim",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Pont_de_Bir-Hakeim_and_the_Eiffel_Tower%2C_April_2007.jpg/3840px-Pont_de_Bir-Hakeim_and_the_Eiffel_Tower%2C_April_2007.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Pont_de_Bir-Hakeim_and_the_Eiffel_Tower%2C_April_2007.jpg/1920px-Pont_de_Bir-Hakeim_and_the_Eiffel_Tower%2C_April_2007.jpg",
    author: "Alexandre Duret-Lutz",
    license: "CC BY-SA 2.0",
    source: "https://commons.wikimedia.org/wiki/File:Pont_de_Bir-Hakeim_and_the_Eiffel_Tower,_April_2007.jpg",
  },
  'london': {
    caption: "Westminster Bridge and the Houses of Parliament",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Westminster_Bridge_panosphere_20250522.jpg/3840px-Westminster_Bridge_panosphere_20250522.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Westminster_Bridge_panosphere_20250522.jpg/1920px-Westminster_Bridge_panosphere_20250522.jpg",
    author: "Domob",
    license: "CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Westminster_Bridge_panosphere_20250522.jpg",
  },
  'rome': {
    caption: "Beside the Colosseum",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Colosseum_%E2%80%93_Panorama_%28Greg_Zaal_and_Rico_Cilliers_via_Poly_Haven%29.jpg/3840px-Colosseum_%E2%80%93_Panorama_%28Greg_Zaal_and_Rico_Cilliers_via_Poly_Haven%29.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Colosseum_%E2%80%93_Panorama_%28Greg_Zaal_and_Rico_Cilliers_via_Poly_Haven%29.jpg/1920px-Colosseum_%E2%80%93_Panorama_%28Greg_Zaal_and_Rico_Cilliers_via_Poly_Haven%29.jpg",
    author: "Greg Zaal (Panorama) Rico Cilliers (Backplates)",
    license: "CC0",
    source: "https://commons.wikimedia.org/wiki/File:Colosseum_%E2%80%93_Panorama_(Greg_Zaal_and_Rico_Cilliers_via_Poly_Haven).jpg",
  },
  'santorini': {
    caption: "Imerovigli, on the caldera rim",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Imerovigli_Panoramic_360_View_-_Santorini.jpg/3840px-Imerovigli_Panoramic_360_View_-_Santorini.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Imerovigli_Panoramic_360_View_-_Santorini.jpg/1920px-Imerovigli_Panoramic_360_View_-_Santorini.jpg",
    author: "Anna.Tsolidou",
    license: "CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Imerovigli_Panoramic_360_View_-_Santorini.jpg",
  },
  'tokyo': {
    caption: "Roppongi Hills",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/360_panorama_of_Roppongi_Hills_-_October_2016.jpg/3840px-360_panorama_of_Roppongi_Hills_-_October_2016.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/360_panorama_of_Roppongi_Hills_-_October_2016.jpg/1920px-360_panorama_of_Roppongi_Hills_-_October_2016.jpg",
    author: "nesnad",
    license: "CC BY-SA 3.0",
    source: "https://commons.wikimedia.org/wiki/File:360_panorama_of_Roppongi_Hills_-_October_2016.jpg",
  },
  'kyoto': {
    caption: "Katsura River, Arashiyama",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Kyoto_Katsura-gawa%2C_Arashiyama_360-degree.jpg/3840px-Kyoto_Katsura-gawa%2C_Arashiyama_360-degree.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Kyoto_Katsura-gawa%2C_Arashiyama_360-degree.jpg/1920px-Kyoto_Katsura-gawa%2C_Arashiyama_360-degree.jpg",
    author: "AsPJT",
    license: "CC0",
    source: "https://commons.wikimedia.org/wiki/File:Kyoto_Katsura-gawa,_Arashiyama_360-degree.jpg",
  },
  'new-york': {
    caption: "National September 11 Memorial",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Ground-Zero-Memorial-Photo-Sphere.jpg/3840px-Ground-Zero-Memorial-Photo-Sphere.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Ground-Zero-Memorial-Photo-Sphere.jpg/1920px-Ground-Zero-Memorial-Photo-Sphere.jpg",
    author: "MartinThoma",
    license: "CC0",
    source: "https://commons.wikimedia.org/wiki/File:Ground-Zero-Memorial-Photo-Sphere.jpg",
  },
  'iceland': {
    caption: "Hallgr\u00edmskirkja, Reykjav\u00edk",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Hallgr%C3%ADmskirkja_Reykjavik_Iceland_360_degree_panorama_2026-02-08_08-00-31_1.jpg/3840px-Hallgr%C3%ADmskirkja_Reykjavik_Iceland_360_degree_panorama_2026-02-08_08-00-31_1.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Hallgr%C3%ADmskirkja_Reykjavik_Iceland_360_degree_panorama_2026-02-08_08-00-31_1.jpg/1920px-Hallgr%C3%ADmskirkja_Reykjavik_Iceland_360_degree_panorama_2026-02-08_08-00-31_1.jpg",
    author: "G. Edward Johnson",
    license: "CC BY 4.0",
    source: "https://commons.wikimedia.org/wiki/File:Hallgr%C3%ADmskirkja_Reykjavik_Iceland_360_degree_panorama_2026-02-08_08-00-31_1.jpg",
  },
  'bengaluru': {
    caption: "VV Puram food street at night",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/A_360_panoramic_view_of_the_food_street%2C_V.V._Puram%2C_Bengaluru.jpg/3840px-A_360_panoramic_view_of_the_food_street%2C_V.V._Puram%2C_Bengaluru.jpg",
    imageSmall: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/A_360_panoramic_view_of_the_food_street%2C_V.V._Puram%2C_Bengaluru.jpg/1920px-A_360_panoramic_view_of_the_food_street%2C_V.V._Puram%2C_Bengaluru.jpg",
    author: "Subhashish Panigrahi",
    license: "CC BY-SA 4.0",
    source: "https://commons.wikimedia.org/wiki/File:A_360_panoramic_view_of_the_food_street,_V.V._Puram,_Bengaluru.jpg",
  },
};
