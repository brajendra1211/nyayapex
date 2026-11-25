import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import prepare_database
from .routers import ai_register, auth, cases, corpus, documents, filing, hearings, law, matters, personal, portal, research, site, work
from .services import embeddings

logging.basicConfig(level=logging.INFO)
prepare_database()

app = FastAPI(title="Nyay Apex API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,  # the session cookie
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Report"],  # PDF builders return their summary in this header
)

embeddings.warm_up()  # load the local embedding model in the background

for r in (ai_register.router, auth.router, law.router, cases.router, corpus.router, documents.router, filing.router, hearings.router,
          matters.router, personal.router, portal.router, research.router, site.router, work.router):
    app.include_router(r)
