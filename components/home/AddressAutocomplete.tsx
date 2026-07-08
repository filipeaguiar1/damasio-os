"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

declare global {
  interface Window {
    google?: any;
    initDamasioGoogleMaps?: () => void;
  }
}

export function AddressAutocomplete({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) return;

    if (window.google?.maps?.places) {
      setMapsReady(true);
      return;
    }

    window.initDamasioGoogleMaps = () => setMapsReady(true);

    const existingScript = document.querySelector("script[data-damasio-google-maps]");
    if (existingScript) return;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initDamasioGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-damasio-google-maps", "true");
    document.head.appendChild(script);
  }, [apiKey]);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || !window.google?.maps?.places) return;

    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "ca" },
      fields: ["formatted_address", "address_components", "geometry"],
      types: ["address"]
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place?.formatted_address) onChange(place.formatted_address);
    });
  }, [mapsReady, onChange]);

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Start typing your address..."
      />
      <small className="helper-text">
        {apiKey ? "Google Maps autocomplete enabled." : "Manual address mode. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable Google Maps."}
      </small>
    </>
  );
}
