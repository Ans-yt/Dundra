import { workspaceRequest } from "../../../lib/access";
import { applyRules, withScopedRules } from "../../../lib/regex-server";
import { exportChatFile, importChatFile, originalFields, connectionAdvanced, chatModelConnection, character, changeChatOptions, chatPreferences, chooseChatPersona, chooseChatProfile, chooseChatThinking, conversation, deleteChat, deleteMessagesFrom, editChatMessage, forkChat, library, memoryStatus, persona, renameChat, saveCharacter, savePersona, selectChatVariant, setWorkspacePersona, startChat, workspacePersonaId } from "../../../lib/store";
import { failure, field, fields, RequestError } from "../../../lib/http";
import { alternateGreetings, GREETING_LIMIT, TEXT_LIMIT } from "../../../lib/cards";
import { readChatOptions } from "../../../lib/chat-options-input";
import { readImage } from "../../../lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function positiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new RequestError("Invalid message or reply variant.");
  return value;
}

function chatSession(id: string) {
  const result = conversation(id);
  if (!result) throw new RequestError("Chat not found.", 404);
  const cfg = withScopedRules(connectionAdvanced(chatModelConnection(id).connection.presetName),originalFields(result.chat.character_id).regex_scripts);
  if (cfg.enabled && cfg.regex) result.messages.forEach((m,i) => {
    if(m.reasoning) m.reasoning=applyRules(cfg,m.reasoning,6,"display",result.messages.length-1-i,m.player?.name || result.chat.persona || "you",result.chat.character);
    m.displayContent = applyRules(cfg,m.content,m.role==="user"?1:2,"display",result.messages.length-1-i,m.player?.name || result.chat.persona || "you",result.chat.character);
  });
  return { ...result, preferences: chatPreferences(id, result) };
}

export async function GET(request: Request) {
  try {
    workspaceRequest(request);
    const query = new URL(request.url).searchParams;
    const memory = query.get("memory");
    if (memory) return Response.json(memoryStatus(memory));
    const id = query.get("chat");
    if (!id) return Response.json(library());
    if (new URL(request.url).searchParams.get("format") === "jsonl") return new Response(exportChatFile(id), { headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": 'attachment; filename="chat-' + encodeURIComponent(id) + '.jsonl"' } });
    return Response.json(chatSession(id));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    workspaceRequest(request);
    const body = await fields(request, new URL(request.url).searchParams.get("format") === "jsonl" ? 24_000_000 : 7_100_000);
    const id = field(body, "id", 64);
    switch (body.action) {
      case "chat-options":
        return Response.json(changeChatOptions(id, readChatOptions(body), readImage(body.background),
          body.profileId === undefined ? undefined : body.profileId === null ? null : field(body, "profileId", 64) || null));
      case "chat-persona":
        chooseChatPersona(id, field(body, "personaId", 64) || null);
        return Response.json(chatSession(id));
      case "edit-message": {
        const content = body.content;
        if (typeof content !== "string" || !content.trim() || content.length > 2_000_000) throw new RequestError("Enter a message under 2,000,000 characters.");
        const current = conversation(id);
        const index = current?.messages.findIndex(m => m.id === body.messageId) ?? -1;
        const edited = current && index >= 0 ? applyRules(withScopedRules(connectionAdvanced(chatModelConnection(id).connection.presetName),originalFields(current.chat.character_id).regex_scripts),content,current.messages[index].role==="user"?1:2,"save",current.messages.length-1-index,current.chat.persona || "you",current.chat.character,true) : content;
        editChatMessage(id, positiveInteger(body.messageId), edited);
        return Response.json(chatSession(id));
      }
      case "delete-messages": {
        const revision = body.revision;
        if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) throw new RequestError("Invalid chat revision.");
        deleteMessagesFrom(id, positiveInteger(body.messageId), revision);
        return Response.json(chatSession(id));
      }
      case "select-variant":
        selectChatVariant(id, positiveInteger(body.messageId), positiveInteger(body.variant));
        return Response.json(chatSession(id));
      case "fork-chat":
        return Response.json({ id: forkChat(id, positiveInteger(body.messageId)) });
      case "chat-profile": {
        chooseChatProfile(id, field(body, "profileId", 64) || null);
        return Response.json(body.includeMessages === true ? chatSession(id) : chatPreferences(id));
      }
      case "chat-thinking":
        return Response.json(chooseChatThinking(id, field(body, "profileId", 64, true), field(body, "level", 32)));
      case "save-character":
        if (id && !character(id)) throw new RequestError("Character not found.", 404);
        saveCharacter({
          id: id || crypto.randomUUID(),
          name: field(body, "name", 80, true),
          description: field(body, "description", 600),
          instructions: field(body, "instructions", TEXT_LIMIT, true),
          greeting: field(body, "greeting", GREETING_LIMIT),
          alternateGreetings: body.alternateGreetings === undefined ? undefined : alternateGreetings(body.alternateGreetings),
          tags: field(body, "tags", 5_000),
        });
        break;
      case "save-persona":
        if (id && !persona(id)) throw new RequestError("Persona not found.", 404);
        savePersona({ id: id || crypto.randomUUID(), name: field(body, "name", 80, true), description: field(body, "description", 4_000) }, readImage(body.portrait));
        break;
      case "default-persona":
        setWorkspacePersona(field(body, "personaId", 64) || null);
        break;
      case "import-chat": {
        const item = character(field(body, "character", 64, true));
        if (!item) throw new RequestError("Choose a character for this chat.");
        const imported = importChatFile(item, field(body, "text", 12_500_000, true), field(body, "title", 100));
        return Response.json(body.open === true ? chatSession(imported) : library());
      }
      case "start-chat": {
        const item = character(field(body, "character", 64, true));
        const playerId = body.persona === undefined ? (item?.defaultPersonaId ?? workspacePersonaId()) : field(body, "persona", 64);
        const player = playerId ? persona(playerId) : undefined;
        if (!item || (playerId && !player)) throw new RequestError("Character or persona not found.", 404);
        const openings = [item.greeting, ...(item.alternateGreetings || [])].filter(Boolean);
        const opening = body.opening ?? 0;
        if (typeof opening !== "number" || !Number.isInteger(opening) || opening < 0 || opening >= Math.max(1, openings.length)) {
          throw new RequestError("This opening message is no longer available.");
        }
        return Response.json({ id: startChat(item, player, opening, body.rememberPersona === true) });
      }
      case "rename-chat":
        if (!renameChat(id, field(body, "title", 100, true))) throw new RequestError("Chat not found.", 404);
        break;
      case "delete-chat":
        if (!deleteChat(id)) throw new RequestError("Chat not found.", 404);
        break;
      default:
        throw new RequestError("Unknown action.");
    }
    return Response.json(library());
  } catch (error) {
    return failure(error);
  }
}
