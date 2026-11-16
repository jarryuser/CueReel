#include <emscripten/bind.h>
#include <memory>
#include <vector>
#include "whisper.h"

using emscripten::val;

static val transcribe(val weights, val samples, val report_progress) {
    auto context_params = whisper_context_default_params();
    context_params.use_gpu = false;
    std::unique_ptr<whisper_context, decltype(&whisper_free)> context(nullptr, whisper_free);
    {
        std::vector<uint8_t> model(weights["length"].as<size_t>());
        val(emscripten::typed_memory_view(model.size(), model.data())).call<void>("set", weights);
        context.reset(whisper_init_from_buffer_with_params(model.data(), model.size(), context_params));
    }
    if (!context) return val::null();

    std::vector<float> audio(samples["length"].as<size_t>());
    val(emscripten::typed_memory_view(audio.size(), audio.data())).call<void>("set", samples);
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = 1;
    params.language = "auto";
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    params.progress_callback_user_data = &report_progress;
    params.progress_callback = [](whisper_context *, whisper_state *, int progress, void * data) {
        (*static_cast<val *>(data))(progress);
    };
    if (whisper_full(context.get(), params, audio.data(), audio.size()) != 0) return val::null();

    auto cues = val::array();
    const int count = whisper_full_n_segments(context.get());
    for (int i = 0; i < count; ++i) {
        auto cue = val::object();
        cue.set("start", whisper_full_get_segment_t0(context.get(), i) / 100.0);
        cue.set("end", whisper_full_get_segment_t1(context.get(), i) / 100.0);
        cue.set("text", std::string(whisper_full_get_segment_text(context.get(), i)));
        cues.call<void>("push", cue);
    }
    return cues;
}

EMSCRIPTEN_BINDINGS(cuereel_whisper) {
    emscripten::function("transcribe", &transcribe);
}
