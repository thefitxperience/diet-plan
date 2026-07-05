import openpyxl, json, os

def load(p):
    wb=openpyxl.load_workbook(p,read_only=True,data_only=True); o={}
    for ws in wb.worksheets: o[ws.title]=list(ws.iter_rows(values_only=True))
    wb.close(); return o

def norm(s):
    if s is None: return ""
    s=str(s).strip().lower().replace("’","'")
    s=" ".join(s.split())
    return s.rstrip(".")

SYN={
  "cardiovascular diseases":"cardiovascular disease",
  "diabetes mellitus":"diabetes",
  "mellitus":"diabetes",
  "gerd (acid reflux)":"gerd",
  "hyperkaliemia":"hyperkalemia",
  "thyroid dysfunction":"thyroid",
}
EXPAND={ "celiac disease / gluten sensitivity":["celiac disease","gluten sensitivity"] }
def canon(name): return SYN.get(norm(name),norm(name))

# Manual corrections to the source export's "Alternative Ingredient" column
# (genuine data errors). key = normalized ingredient name; value = list of
# {name, restrictions:[raw labels]}. These REPLACE the exported alternatives.
ALT_OVERRIDES={
  # Labneh's exported alternative "Labneh, low fat" carries the exact same
  # restrictions as Labneh (still lactose), so it never resolves anything.
  # Every other dairy item has a lactose-free variant — add one for Labneh.
  # Lactose-free dairy still carries Phenylketonuria (like Yogurt/Cottage
  # Cheese/Feta Lactose-Free), but drops Lactose Intolerance and IBS.
  "labneh":[ {"name":"Labneh, Lactose-Free","restrictions":["Phenylketonuria"]} ],
}

# API-selectable restriction names (fetched live from the proxy on 2026-07-05)
API_CONDITIONS=["Cardiovascular Disease","Cardiovascular Diseases","Celiac disease","Chronic Kidney Disease","Diabetes","Diabetes Mellitus","Fatty Liver Disease","Favism","GERD","GERD (Acid Reflux)","Gout","Hemochromatosis","Histamine Intolerance","Hypercholesterolemia","Hyperkalemia","hyperkaliemia","Hypertension","Hyperthyroidism","Hypoglycemia","IBS","Kidney Stones","Lactose Intolerance","Mellitus","Nut allergy","Oral Allergy Syndrome","Pancreatitis","Phenylketonuria","Thyroid","Thyroid Dysfunction","Wilson’s Disease"]
API_ALLERGIES=["Celiac Disease","Celiac Disease / Gluten Sensitivity","Egg Allergy","Gluten Sensitivity","Latex-Fruit Cross-Reactivity","Latex-Fruit Syndrome","Legume Family Cross-Reactivity","Nut Allergy","Oral Allergy Syndrome","Phenylketonuria","SeaFood Allergy","Sesame Allergy","Soy allergy","Wheat Allergy"]

ING=load("/Users/andyayas/Desktop/Diet Plan/Ingredients.xlsx")["Sheet1"][1:]
MB=load("/Users/andyayas/Desktop/Diet Plan/Meal Breakdown.xlsx")
MBI=MB["Ingredients"][1:]

ingredients={}
for r in ING:
    name=r[1]
    if name is None: continue
    if norm(name)=="25": continue
    k=norm(name)
    e=ingredients.setdefault(k,{"name":str(name).strip(),"restrictions":set()})
    for cell in (r[2],r[3]):
        if cell and str(cell).strip(): e["restrictions"].add(canon(cell))

alts={}
for r in MBI:
    ingname=r[1]; alt=r[3]
    if alt and str(alt).strip():
        k=norm(ingname); altk=norm(alt)
        altrestr=sorted(ingredients.get(altk,{}).get("restrictions",set())) if altk in ingredients else []
        lst=alts.setdefault(k,[])
        if not any(a["name"]==str(alt).strip() for a in lst):
            lst.append({"name":str(alt).strip(),"restrictions":altrestr})
# apply manual corrections (replace the exported alternatives for these keys)
for k,override in ALT_OVERRIDES.items():
    alts[k]=[{"name":o["name"],"restrictions":sorted({canon(r) for r in o["restrictions"]})} for o in override]

for k,lst in alts.items():
    e=ingredients.setdefault(k,{"name":k,"restrictions":set()})
    e["alternatives"]=lst

names=set(API_CONDITIONS)|set(API_ALLERGIES)
for r in ING:
    for cell in (r[2],r[3]):
        if cell and str(cell).strip(): names.add(str(cell).strip())

restrictionCanonical={}; restrictionExpand={}
for nm in names:
    n=norm(nm)
    if n in EXPAND: restrictionExpand[n]=EXPAND[n]
    else: restrictionCanonical[n]=canon(nm)

out={
  "_note":"Generated from Ingredients.xlsx + Meal Breakdown.xlsx (exports from the FIT DB). Regenerate with scripts/gen_dietary_data.py; do not hand-edit.",
  "restrictionCanonical":dict(sorted(restrictionCanonical.items())),
  "restrictionExpand":restrictionExpand,
  "ingredients":{}
}
for k in sorted(ingredients):
    e=ingredients[k]; rec={"name":e["name"],"restrictions":sorted(e["restrictions"])}
    if e.get("alternatives"): rec["alternatives"]=e["alternatives"]
    out["ingredients"][k]=rec

dst="/Users/andyayas/Desktop/Diet Plan/nutrifit/src/data/dietaryData.json"
os.makedirs(os.path.dirname(dst),exist_ok=True)
with open(dst,"w") as f: json.dump(out,f,ensure_ascii=False,indent=1)
print("wrote",dst)
print("ingredients:",len(out["ingredients"]),"| with alternatives:",sum(1 for v in out["ingredients"].values() if v.get("alternatives")))
print("restrictionCanonical:",len(restrictionCanonical),"expand:",restrictionExpand)
print("sample WWbread:",json.dumps(out["ingredients"][norm("Whole wheat bread")],ensure_ascii=False))
print("sample labneh :",json.dumps(out["ingredients"][norm("Labneh")],ensure_ascii=False))
